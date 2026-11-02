'use strict';

// Is the Claude desktop app running?
// Uses `ps -axo command=` and an exact match on the app's main executable.
// (pgrep cannot see the app from inside a Claude Code sandbox; ps can.)

const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function appCommands() {
  // Tests set TTS_APP_MATCH to a stand-in process's exact command line.
  if (process.env.TTS_APP_MATCH) return [process.env.TTS_APP_MATCH];
  const exe = path.join('Claude.app', 'Contents', 'MacOS', 'Claude');
  return [path.join('/Applications', exe), path.join(os.homedir(), 'Applications', exe)];
}

function isClaudeRunning() {
  const out = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const wanted = new Set(appCommands());
  return out.split('\n').some((line) => wanted.has(line.trim()));
}

// The installed Claude app's version, for reports and bug reports. null if not found.
function claudeVersion() {
  if (process.env.TTS_APP_MATCH) return null; // tests use a stand-in app
  for (const cmd of appCommands()) {
    const plist = path.join(path.dirname(path.dirname(cmd)), 'Info.plist');
    try {
      return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* not installed there */ }
  }
  return null;
}

module.exports = { isClaudeRunning, claudeVersion };
