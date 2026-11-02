'use strict';

// Builds a synthetic Claude data folder in a temp dir. Never uses a real store.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { ClassicLevel } = require('classic-level');
const ls = require('../lib/localstorage');

const CLI = path.resolve(__dirname, '..', 'bin', 'tide-the-side.js');
const NEVER = '/nonexistent/claude-stand-in-never-running';

function presetsDoc(presets, placeDefaults = {}) {
  return { state: { presets, placeDefaults, builtIns: {}, seededFromDraft: true, fileMirrored: true, seededFromHistory: 2 }, version: 4 };
}

function preset(cwd, extra = {}) {
  return { id: crypto.randomUUID(), name: path.basename(cwd), createdAt: 1700000000000, lastUsedAt: 1700000000000, target: { kind: 'local', cwd }, ...extra };
}

const SETTINGS = (model = 'model-a', effort = 'high') => ({ modelId: model, effort, fastMode: false });

class Fixture {
  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-')));
    this.app = path.join(this.root, 'Claude');
    this.home = path.join(this.root, 'tool');
    this.db = path.join(this.app, 'Local Storage', 'leveldb');
    this.account = crypto.randomUUID();
    this.org = crypto.randomUUID();
    this.env = { ...process.env, TTS_APP_SUPPORT: this.app, TTS_HOME: this.home, TTS_APP_MATCH: NEVER };
  }

  folder(...parts) {
    const p = path.join(this.root, 'w', ...parts);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  // entries: { [keyName]: string (encoded like Chromium) | Buffer (raw value) }
  async writeStore(entries) {
    fs.mkdirSync(this.db, { recursive: true });
    const db = new ClassicLevel(this.db, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    await db.open();
    await db.put(Buffer.from('META:https://claude.ai', 'latin1'), Buffer.from([0x08, 0x01]));
    for (const [name, v] of Object.entries(entries)) {
      await db.put(ls.keyFor(name), Buffer.isBuffer(v) ? v : ls.encodeValue(v));
    }
    await db.close();
  }

  presetsKey() { return `persisted.ccd-session-presets.${this.account}`; }
  orderKey() { return `LSS-persisted.code-projects-order.${this.account}`; }

  async setup({ presets, placeDefaults, order, mirror, rawPresets, extra = {} }) {
    const entries = { ...extra };
    entries[this.presetsKey()] = rawPresets !== undefined ? rawPresets : JSON.stringify(presetsDoc(presets, placeDefaults));
    // A roaming key that must be left alone.
    entries[`${this.presetsKey()}.${this.org}`] = JSON.stringify(presetsDoc([]));
    if (order) entries[this.orderKey()] = JSON.stringify({ value: order });
    await this.writeStore(entries);
    const config = { mcpServers: {}, preferences: { epitaxyPrefs: {} } };
    if (mirror) config.preferences.epitaxyPrefs[`code-projects-order.${this.account}`] = mirror;
    fs.writeFileSync(path.join(this.app, 'claude_desktop_config.json'), JSON.stringify(config, null, 2) + '\n');
  }

  session(cwd, extra = {}) {
    const dir = path.join(this.app, 'claude-code-sessions', this.account, this.org);
    fs.mkdirSync(dir, { recursive: true });
    const id = `local_${crypto.randomUUID()}`;
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ cwd, originCwd: cwd, isArchived: false, title: 'test', lastActivityAt: Date.now(), ...extra }));
  }

  run(args, env = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...this.env, ...env }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  spawn(args, env = {}) {
    return spawn(process.execPath, [CLI, ...args], { env: { ...this.env, ...env } });
  }

  async read(name) {
    const db = new ClassicLevel(this.db, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open();
    try {
      const v = await db.get(ls.keyFor(name));
      return v === undefined ? null : ls.decodeValue(v, name).text;
    } catch (e) {
      if (e.code === 'LEVEL_NOT_FOUND') return null;
      throw e;
    } finally {
      await db.close();
    }
  }

  async order() { const t = await this.read(this.orderKey()); return t && JSON.parse(t).value; }
  async presets() { return JSON.parse(await this.read(this.presetsKey())); }

  // Every key and value, as hex, to prove nothing was written.
  async dump() {
    const db = new ClassicLevel(this.db, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open();
    const out = [];
    for await (const [k, v] of db.iterator()) out.push(`${k.toString('hex')}=${v.toString('hex')}`);
    await db.close();
    return out.join('\n');
  }

  config() { return JSON.parse(fs.readFileSync(path.join(this.app, 'claude_desktop_config.json'), 'utf8')); }

  backups() { try { return fs.readdirSync(path.join(this.home, 'backups')).sort(); } catch { return []; } }

  cleanup() { fs.rmSync(this.root, { recursive: true, force: true }); }
}

module.exports = { Fixture, preset, presetsDoc, SETTINGS, NEVER };
