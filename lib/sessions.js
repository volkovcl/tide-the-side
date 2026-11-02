'use strict';

// Which folders have Code sessions, from
//   <Claude>/claude-code-sessions/<account>/<org>/local_*.json   (fields: cwd, originCwd, isArchived, lastActivityAt)

const fs = require('fs');
const path = require('path');
const { sessionsDir } = require('./paths');
const { toMs } = require('./model');

// -> { folders: Map(folder -> { count, lastActivityMs }), unreadable: n }
function scanSessions(account, { includeArchived = false } = {}) {
  const folders = new Map();
  let unreadable = 0;
  const accountDir = path.join(sessionsDir(), account);
  let orgs = [];
  try { orgs = fs.readdirSync(accountDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return { folders, unreadable }; }
  for (const org of orgs) {
    const dir = path.join(accountDir, org.name);
    for (const f of fs.readdirSync(dir)) {
      if (!/^local_.*\.json$/.test(f)) continue;
      let s;
      try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { unreadable++; continue; }
      if (!s || typeof s !== 'object') { unreadable++; continue; }
      if (s.isArchived === true && !includeArchived) continue;
      // A worktree session runs in a copy; its heading is the folder it came from.
      const folder = typeof s.originCwd === 'string' && s.originCwd ? s.originCwd : s.cwd;
      if (typeof folder !== 'string' || !folder.startsWith('/')) continue;
      const cur = folders.get(folder) || { count: 0, lastActivityMs: 0 };
      cur.count++;
      cur.lastActivityMs = Math.max(cur.lastActivityMs, toMs(s.lastActivityAt));
      folders.set(folder, cur);
    }
  }
  return { folders, unreadable };
}

module.exports = { scanSessions };
