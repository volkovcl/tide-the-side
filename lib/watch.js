'use strict';

// Optional quit watcher: re-sorts the headings each time Claude quits.
// Claude can quit and reopen within a few seconds (Cmd+Q and reopen, or an update relaunch),
// so it polls about every 0.5 s and acts 1 s after it sees the quit, if Claude is still closed.
// The whole write takes about a second.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { isClaudeRunning } = require('./claude');
const { toolHome } = require('./paths');
const tidy = require('./tidy');

const LABEL = 'local.tide-the-side.watch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(event, extra = {}) {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), event, ...extra }) + '\n');
}

async function runWatcher(opts = {}) {
  const pollMs = Number(process.env.TTS_POLL_MS) || 500;
  const settleMs = Number(process.env.TTS_SETTLE_MS) || 1000;
  let wasRunning = isClaudeRunning();
  log('started', { claudeRunning: wasRunning });
  for (;;) {
    await sleep(pollMs);
    let running;
    try { running = isClaudeRunning(); } catch (e) { log('error', { message: `ps failed: ${e.message}` }); continue; }
    if (wasRunning && !running) {
      log('quit-seen');
      await sleep(settleMs);
      if (isClaudeRunning()) { log('skipped', { reason: 'Claude reopened' }); wasRunning = true; continue; }
      try {
        const r = await tidy.apply(opts);
        log(r.wrote ? 'applied' : 'nothing-to-do', r.wrote ? { backup: r.backup } : {});
      } catch (e) {
        if (e.name === 'BusyError') log('yielded', { reason: e.message });
        else log(e.name === 'StopError' ? 'stopped' : 'error', { message: e.message });
      }
      running = isClaudeRunning();
    }
    wasRunning = running;
  }
}

// ---------- LaunchAgent ----------

function plistPath() { return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`); }

function nodePath() {
  // Prefer a stable symlink over a versioned Homebrew path that disappears on upgrade.
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    try { if (fs.realpathSync(p) === fs.realpathSync(process.execPath)) return p; } catch { /* not there */ }
  }
  return process.execPath;
}

function xml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function plistText(args) {
  const logFile = path.join(toolHome(), 'watch.log');
  const items = [nodePath(), path.resolve(__dirname, '..', 'bin', 'tide-the-side.js'), 'watch', 'run', ...args]
    .map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

function domain() { return `gui/${process.getuid()}`; }

function install(args) {
  fs.mkdirSync(toolHome(), { recursive: true });
  const text = plistText(args);
  try {
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.writeFileSync(plistPath(), text);
  } catch (e) {
    return { ok: false, message: `could not write ${plistPath()} (${e.code || e.message}). If you are running this from inside Claude Code, run the same command in the Terminal app instead.` };
  }
  try { execFileSync('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'pipe' }); } catch { /* was not loaded */ }
  try {
    execFileSync('/bin/launchctl', ['bootstrap', domain(), plistPath()], { stdio: 'pipe' });
  } catch (e) {
    return { ok: false, message: `wrote ${plistPath()} but launchctl could not load it: ${String(e.stderr || e.message).trim()}` };
  }
  return { ok: true, message: `watcher installed and running (${LABEL}); log: ${path.join(toolHome(), 'watch.log')}` };
}

function uninstall() {
  try { execFileSync('/bin/launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'pipe' }); } catch { /* not loaded */ }
  try { fs.unlinkSync(plistPath()); } catch (e) { if (e.code !== 'ENOENT') return { ok: false, message: `could not remove ${plistPath()}: ${e.message}` }; }
  return { ok: true, message: 'watcher removed' };
}

function status() {
  let loaded = false;
  try { execFileSync('/bin/launchctl', ['print', `${domain()}/${LABEL}`], { stdio: 'pipe' }); loaded = true; } catch { /* not loaded */ }
  let tail = '';
  try { tail = fs.readFileSync(path.join(toolHome(), 'watch.log'), 'utf8').trim().split('\n').slice(-5).join('\n'); } catch { /* no log */ }
  return { installed: fs.existsSync(plistPath()), loaded, tail };
}

module.exports = { runWatcher, install, uninstall, status, plistText, LABEL };
