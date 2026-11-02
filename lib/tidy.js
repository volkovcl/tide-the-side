'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { storeDir, configFile } = require('./paths');
const { StopError, BusyError } = require('./errors');
const store = require('./store');
const { planAccount } = require('./model');
const { scanSessions } = require('./sessions');
const { isClaudeRunning } = require('./claude');
const lock = require('./lock');
const backup = require('./backup');

const MIRROR_PREFIX = 'code-projects-order.';

// ---------- claude_desktop_config.json (only the heading-order copy is ever touched) ----------

function readConfig() {
  let text;
  try { text = fs.readFileSync(configFile(), 'utf8'); } catch { return null; }
  try { return { text, json: JSON.parse(text) }; } catch { throw new StopError('claude_desktop_config.json is not valid JSON'); }
}

function mirrorValue(config, account) {
  const prefs = config?.json?.preferences?.epitaxyPrefs;
  if (!prefs || typeof prefs !== 'object') return undefined;
  return prefs[MIRROR_PREFIX + account];
}

function writeConfig(text, json) {
  const m = /\n([ \t]+)"/.exec(text);
  const indent = m ? m[1] : 2;
  const out = JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : '');
  const tmp = configFile() + '.tts-tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, configFile());
}

// ---------- planning ----------

function planFrom(data, opts) {
  const config = readConfig();
  const accounts = Object.keys(data.accounts).sort();
  if (!accounts.length) throw new StopError('found no saved setups (persisted.ccd-session-presets.*) in the Claude store; this app version may store them differently');
  return accounts.map((account, i) => {
    const a = data.accounts[account];
    const { folders, unreadable } = scanSessions(account, opts);
    const plan = planAccount({
      label: accounts.length > 1 ? `account ${i + 1} (${account.slice(0, 8)}…)` : 'this account',
      presetsText: a.presets.text,
      orderText: a.order ? a.order.text : null,
      mirrorValue: mirrorValue(config, account),
      sessions: folders,
      folderExists: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
      now: Date.now(),
      opts,
    });
    if (unreadable) plan.notes.push(`${unreadable} session file(s) could not be read and were skipped`);
    plan.account = account;
    return plan;
  });
}

function hasChanges(plans) { return plans.some((p) => p.presetsText || p.orderText); }

// Read a throwaway copy, so even a dry run never touches the real store (opening LevelDB can rewrite its files).
async function readCopyOf(dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  try {
    backup.copyTree(dir, path.join(tmp, 'leveldb'));
    try { fs.unlinkSync(path.join(tmp, 'leveldb', 'LOCK')); } catch { /* none */ }
    return await store.readStoreAt(path.join(tmp, 'leveldb'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function plan(opts = {}) {
  if (!fs.existsSync(storeDir())) throw new StopError(`no Claude store at ${storeDir()}`);
  return { plans: planFrom(await readCopyOf(storeDir()), opts), claudeRunning: isClaudeRunning() };
}

// ---------- apply ----------

async function apply(opts = {}) {
  if (isClaudeRunning()) throw new BusyError('Claude is open. Quit it fully (Cmd+Q), then run apply again.');
  const release = lock.acquire();
  try {
    const name = backup.makeBackup('before apply');
    const first = planFrom(await readCopyOf(path.join(backup.backupsDir(), name, 'leveldb')), opts);
    if (!hasChanges(first)) {
      backup.deleteBackup(name);
      return { plans: first, backup: null, wrote: false };
    }
    if (isClaudeRunning()) { backup.deleteBackup(name); throw new BusyError('Claude was opened; nothing written.'); }

    const db = await store.openDb(storeDir());
    let plans;
    try {
      plans = planFrom(await store.readDb(db), opts); // same data as the backup, since Claude is closed
      const writes = [];
      for (const p of plans) {
        if (p.presetsText) writes.push({ name: store.presetsKeyName(p.account), text: p.presetsText });
        if (p.orderText) writes.push({ name: store.orderKeyName(p.account), text: p.orderText });
      }
      await store.writeDb(db, writes);
      for (const w of writes) {
        if ((await store.getText(db, w.name)) !== w.text) throw new StopError(`read-back of ${w.name} did not match; restore backup ${name}`);
      }
    } finally {
      await db.close();
    }

    const mirrorWrites = plans.filter((p) => p.mirror);
    if (mirrorWrites.length) {
      const config = readConfig();
      for (const p of mirrorWrites) config.json.preferences.epitaxyPrefs[MIRROR_PREFIX + p.account] = p.mirror;
      writeConfig(config.text, config.json);
    }
    backup.pruneBackups(opts.keep || 10);
    return { plans, backup: name, wrote: true };
  } finally {
    release();
  }
}

// ---------- restore ----------

async function restore(name, opts = {}) {
  const found = backup.listBackups().find((b) => b.name === name);
  if (!found) throw new StopError(`no backup named ${name}; run "backups" to list them`);
  if (isClaudeRunning()) throw new BusyError('Claude is open. Quit it fully (Cmd+Q), then run restore again.');
  const release = lock.acquire();
  try {
    const safety = backup.makeBackup(`before restoring ${name}`);
    const live = storeDir();
    const aside = `${live}.tts-aside-${process.pid}`;
    fs.renameSync(live, aside);
    try {
      backup.copyTree(path.join(found.dir, 'leveldb'), live);
    } catch (e) {
      fs.rmSync(live, { recursive: true, force: true });
      fs.renameSync(aside, live);
      throw e;
    }
    fs.rmSync(aside, { recursive: true, force: true });

    // Put back only the heading-order copies; the rest of the config file may have changed since.
    const savedPath = path.join(found.dir, 'claude_desktop_config.json');
    const current = readConfig();
    if (current && fs.existsSync(savedPath)) {
      const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
      const from = saved?.preferences?.epitaxyPrefs || {};
      const to = current.json?.preferences?.epitaxyPrefs;
      if (to && typeof to === 'object') {
        const keys = new Set([...Object.keys(from), ...Object.keys(to)].filter((k) => k.startsWith(MIRROR_PREFIX)));
        for (const k of keys) { if (k in from) to[k] = from[k]; else delete to[k]; }
        if (keys.size) writeConfig(current.text, current.json);
      }
    }
    backup.pruneBackups(Math.max(opts.keep || 10, 2));
    return { safety };
  } finally {
    release();
  }
}

module.exports = { plan, apply, restore, hasChanges };
