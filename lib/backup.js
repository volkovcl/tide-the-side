'use strict';

// Whole-store backups. On APFS `cp -c` makes a clone: instant, and no extra disk space until files change.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { toolHome, storeDir, configFile } = require('./paths');
const { StopError } = require('./errors');

function backupsDir() { return path.join(toolHome(), 'backups'); }

function copyTree(src, dest) {
  try {
    execFileSync('/bin/cp', ['-cR', src, dest], { stdio: 'pipe' });
  } catch {
    fs.rmSync(dest, { recursive: true, force: true });
    execFileSync('/bin/cp', ['-R', src, dest], { stdio: 'pipe' }); // not APFS: plain copy
  }
}

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

// -> backup name
function makeBackup(reason) {
  const src = storeDir();
  if (!fs.existsSync(src)) throw new StopError(`no Claude store at ${src}`);
  fs.mkdirSync(backupsDir(), { recursive: true });
  let name = stamp();
  while (fs.existsSync(path.join(backupsDir(), name))) name += 'x';
  const dir = path.join(backupsDir(), name);
  fs.mkdirSync(dir);
  copyTree(src, path.join(dir, 'leveldb'));
  if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), path.join(dir, 'claude_desktop_config.json'));
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ reason, createdAt: new Date().toISOString() }, null, 2));
  return name;
}

function listBackups() {
  let names = [];
  try { names = fs.readdirSync(backupsDir()).filter((n) => fs.existsSync(path.join(backupsDir(), n, 'leveldb'))); } catch { return []; }
  return names.sort().map((name) => {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(backupsDir(), name, 'info.json'), 'utf8')); } catch { /* no info */ }
    return { name, reason: info.reason || '', dir: path.join(backupsDir(), name) };
  });
}

function pruneBackups(keep) {
  const all = listBackups();
  for (const b of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(b.dir, { recursive: true, force: true });
}

function deleteBackup(name) {
  fs.rmSync(path.join(backupsDir(), name), { recursive: true, force: true });
}

module.exports = { makeBackup, listBackups, pruneBackups, deleteBackup, backupsDir, copyTree };
