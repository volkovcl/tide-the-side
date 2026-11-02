'use strict';

// A lock held only for the check-and-write, so a manual run and the quit watcher never write at once.
// The file holds the writer's pid. A lock whose pid is gone, or that is older than 5 minutes, is stale.

const fs = require('fs');
const path = require('path');
const { toolHome } = require('./paths');
const { BusyError } = require('./errors');

const STALE_MS = 5 * 60 * 1000;

function lockPath() { return path.join(toolHome(), 'write.lock'); }

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// -> { pid, alive } or null
function readLock() {
  let text;
  let st;
  try { text = fs.readFileSync(lockPath(), 'utf8'); st = fs.statSync(lockPath()); } catch { return null; }
  const pid = parseInt(text, 10);
  const fresh = Date.now() - st.mtimeMs < STALE_MS;
  return { pid, alive: fresh && pidAlive(pid) };
}

function acquire() {
  fs.mkdirSync(toolHome(), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath(), 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { if (readLock()?.pid === process.pid) fs.unlinkSync(lockPath()); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const cur = readLock();
      if (cur && cur.alive) throw new BusyError(`another write is in progress (pid ${cur.pid})`);
      try { fs.unlinkSync(lockPath()); } catch { /* raced; retry */ }
    }
  }
  throw new BusyError('could not take the write lock');
}

module.exports = { acquire, readLock, lockPath };
