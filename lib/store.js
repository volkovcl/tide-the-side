'use strict';

// Reads and writes the two localStorage keys this tool cares about:
//   persisted.ccd-session-presets.<account>       saved setups (one sidebar heading each)
//   LSS-persisted.code-projects-order.<account>   heading order (absent on some machines)

const { ClassicLevel } = require('classic-level');
const { StopError, BusyError } = require('./errors');
const ls = require('./localstorage');

const PRESETS_RE = /^persisted\.ccd-session-presets\.([^.]+)$/; // a ".<org>" suffix (roaming presets) is left alone
const ORDER_RE = /^LSS-persisted\.code-projects-order\.([^.]+)$/;

function presetsKeyName(account) { return `persisted.ccd-session-presets.${account}`; }
function orderKeyName(account) { return `LSS-persisted.code-projects-order.${account}`; }

async function openDb(dir) {
  const db = new ClassicLevel(dir, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  try {
    await db.open();
  } catch (err) {
    const cause = err.cause || err;
    if (/lock/i.test(String(cause.message || cause))) {
      throw new BusyError('the Claude store is locked; Claude (or another program) has it open');
    }
    throw new StopError(`could not open the Claude store at ${dir}: ${cause.message || cause}`);
  }
  return db;
}

// Returns { accounts: { [id]: { presets: {text, encoding}, order: {text, encoding} | null } } }
async function readDb(db) {
  const accounts = {};
  const orders = {};
  for await (const [key, value] of db.iterator({ gte: ls.KEY_PREFIX, lt: ls.KEY_PREFIX_END })) {
    const name = ls.nameOf(key);
    if (!name) continue;
    let m = PRESETS_RE.exec(name);
    if (m) {
      accounts[m[1]] = { presets: ls.decodeValue(value, name), order: null };
      continue;
    }
    m = ORDER_RE.exec(name);
    if (m) orders[m[1]] = ls.decodeValue(value, name);
  }
  // Only accounts with a presets key count; an order list alone belongs to no signed-in account we know.
  for (const id of Object.keys(accounts)) accounts[id].order = orders[id] || null;
  return { accounts };
}

async function readStoreAt(dir) {
  const db = await openDb(dir);
  try {
    return await readDb(db);
  } finally {
    await db.close();
  }
}

// writes: [{ name, text }]. One atomic batch.
async function writeDb(db, writes) {
  const ops = writes.map((w) => ({ type: 'put', key: ls.keyFor(w.name), value: ls.encodeValue(w.text) }));
  await db.batch(ops);
}

async function getText(db, name) {
  try {
    const v = await db.get(ls.keyFor(name));
    if (v === undefined) return null; // classic-level 2.x returns undefined
    return ls.decodeValue(v, name).text;
  } catch (err) {
    if (err.code === 'LEVEL_NOT_FOUND') return null; // classic-level 1.x throws
    throw err;
  }
}

module.exports = { openDb, readDb, readStoreAt, writeDb, getText, presetsKeyName, orderKeyName };
