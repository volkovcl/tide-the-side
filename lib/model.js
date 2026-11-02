'use strict';

// Pure planning logic: given what is in the store, work out what should change.
// Nothing here touches the disk except the folder-exists check passed in by the caller.

const path = require('path');
const crypto = require('crypto');
const { StopError } = require('./errors');

const PRESETS_VERSION = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Folder names too common to tell headings apart; these get " (parent)" added.
const GENERIC_NAMES = new Set([
  'workspace', 'workspaces', 'project', 'projects', 'src', 'code', 'repo', 'repos',
  'app', 'work', 'dev', 'main', 'tmp', 'temp', 'test', 'tests', 'home', 'documents', 'desktop',
]);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function normPath(p) { return p.length > 1 ? p.replace(/\/+$/, '') : p; }

// ---------- parsing (strict: anything unexpected stops the tool) ----------

function parsePresets(text, label) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new StopError(`${label}: saved setups are not valid JSON`); }
  if (!isPlainObject(doc)) throw new StopError(`${label}: saved setups are not a JSON object`);
  if (doc.version !== PRESETS_VERSION) {
    throw new StopError(`${label}: saved setups have version ${JSON.stringify(doc.version)}; this tool knows version ${PRESETS_VERSION}`);
  }
  const s = doc.state;
  if (!isPlainObject(s) || !Array.isArray(s.presets)) throw new StopError(`${label}: saved setups have no "state.presets" list`);
  if (s.placeDefaults !== undefined && !isPlainObject(s.placeDefaults)) {
    throw new StopError(`${label}: "state.placeDefaults" is not an object`);
  }
  for (const p of s.presets) {
    if (!isPlainObject(p) || typeof p.id !== 'string' || !isPlainObject(p.target) || typeof p.target.kind !== 'string') {
      throw new StopError(`${label}: a saved setup does not have the expected shape (id, target.kind)`);
    }
    if (p.target.kind === 'local' && (typeof p.target.cwd !== 'string' || !p.target.cwd.startsWith('/'))) {
      throw new StopError(`${label}: a local saved setup has no absolute folder (target.cwd)`);
    }
    if (p.settings !== undefined && !isPlainObject(p.settings)) {
      throw new StopError(`${label}: a saved setup has "settings" that is not an object`);
    }
  }
  return doc;
}

function parseOrder(text, label) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new StopError(`${label}: heading order is not valid JSON`); }
  if (!isPlainObject(doc) || !Array.isArray(doc.value) || !doc.value.every((x) => typeof x === 'string')) {
    throw new StopError(`${label}: heading order is not {"value": [folder paths]}`);
  }
  return doc;
}

// The mirror in claude_desktop_config.json: either a bare list or {"value": list}.
function mirrorList(v, label) {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return { list: v, wrapped: false };
  if (isPlainObject(v) && Array.isArray(v.value) && v.value.every((x) => typeof x === 'string')) return { list: v.value, wrapped: true };
  throw new StopError(`${label}: the heading-order copy in claude_desktop_config.json has an unexpected shape`);
}

// ---------- heading names and order ----------

// entries: [{ cwd, presetName? }] -> Map(cwd -> heading name)
function headingNames(entries) {
  const counts = new Map();
  for (const e of entries) {
    const b = path.basename(e.cwd).toLowerCase();
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const names = new Map();
  for (const e of entries) {
    if (typeof e.presetName === 'string' && e.presetName.trim()) {
      names.set(e.cwd, e.presetName.trim());
      continue;
    }
    const base = path.basename(e.cwd) || e.cwd;
    const needsParent = counts.get(base.toLowerCase()) > 1 || GENERIC_NAMES.has(base.toLowerCase());
    const parent = path.basename(path.dirname(e.cwd));
    names.set(e.cwd, needsParent && parent ? `${base} (${parent})` : base);
  }
  return names;
}

function sortPaths(paths, names) {
  return [...paths].sort((a, b) => collator.compare(names.get(a), names.get(b)) || (a < b ? -1 : a > b ? 1 : 0));
}

// ---------- helpers for new saved setups ----------

function idMaker(presets, label) {
  const ids = presets.map((p) => p.id);
  if (ids.length > 0 && ids.every((id) => UUID_RE.test(id))) return () => crypto.randomUUID();
  throw new StopError(`${label}: cannot tell how saved-setup ids are made (expected UUIDs), so no heading is added`);
}

function timeMaker(presets, label) {
  const kinds = new Set(presets.map((p) => typeof p.createdAt));
  if (kinds.size === 1 && kinds.has('number')) return (ms) => ms;
  if (kinds.size === 1 && kinds.has('string')) return (ms) => new Date(ms).toISOString();
  throw new StopError(`${label}: cannot tell how saved-setup times are stored, so no heading is added`);
}

function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
  return 0;
}

function hasSettings(s) { return isPlainObject(s) && typeof s.modelId === 'string' && s.modelId && typeof s.effort === 'string' && s.effort; }

// ---------- the plan for one account ----------

/**
 * input: {
 *   label, presetsText, orderText|null, mirrorValue|undefined,
 *   sessions: Map(folder -> { count, lastActivityMs }),
 *   folderExists(cwd) -> bool, now (ms),
 *   opts: { addHeadings, fillSettings, model, effort, fast }
 * }
 * returns { label, notes[], presetsText|null (new value), orderText|null (new value), mirror|null, summary }
 */
function planAccount(input) {
  const { label, opts = {} } = input;
  const notes = [];
  const doc = parsePresets(input.presetsText, label);
  const orderDoc = input.orderText != null ? parseOrder(input.orderText, label) : null;
  const mirror = input.mirrorValue !== undefined ? mirrorList(input.mirrorValue, label) : null;
  const presets = doc.state.presets;
  const local = presets.filter((p) => p.target.kind === 'local');
  const byCwd = new Map(local.map((p) => [normPath(p.target.cwd), p]));
  let presetsChanged = false;
  const added = [];
  const filled = [];

  // 1. Headings for session folders that have none (only when asked).
  const missing = [];
  for (const [folder, info] of input.sessions || new Map()) {
    const cwd = normPath(folder);
    if (byCwd.has(cwd)) continue;
    if (!input.folderExists(cwd)) { notes.push(`no heading for ${cwd}: the folder no longer exists, skipped`); continue; }
    missing.push({ cwd, info });
  }
  if (missing.length && !opts.addHeadings) {
    notes.push(`${missing.length} folder(s) with sessions have no heading of their own; add --add-headings to add them`);
  }
  if (missing.length && opts.addHeadings) {
    const newId = idMaker(presets, label);
    const time = timeMaker(presets, label);
    const allEntries = [...byCwd.keys(), ...missing.map((m) => m.cwd)].map((cwd) => ({ cwd }));
    const fallbackNames = headingNames(allEntries);
    for (const m of missing) {
      const p = {
        id: newId(),
        name: fallbackNames.get(m.cwd),
        createdAt: time(input.now),
        lastUsedAt: time(m.info.lastActivityMs || input.now),
        target: { kind: 'local', cwd: m.cwd },
      };
      presets.push(p);
      byCwd.set(m.cwd, p);
      added.push(p);
    }
    presetsChanged = true;
  }

  // 2. Remembered model and effort for "+" (only when asked; never invented).
  if (opts.fillSettings) {
    const pd = doc.state.placeDefaults;
    const placeKey = (p) => `local::${p.target.cwd}`;
    const needs = [...byCwd.values()].filter((p) => !hasSettings(p.settings) || !pd || !hasSettings(pd[placeKey(p)]));
    if (needs.length) {
      if (!pd) throw new StopError(`${label}: saved setups have no "placeDefaults"; not sure where remembered settings go`);
      let source = null;
      let sourceDesc = '';
      if (opts.model || opts.effort) {
        if (!opts.model || !opts.effort) throw new StopError('give both --model and --effort, or neither');
        source = { modelId: opts.model, effort: opts.effort, fastMode: !!opts.fast };
        sourceDesc = 'the --model and --effort you gave';
      } else {
        const donors = [...byCwd.values()].filter((p) => hasSettings(p.settings)).sort((a, b) => toMs(b.lastUsedAt) - toMs(a.lastUsedAt));
        if (donors.length) {
          source = donors[0].settings;
          sourceDesc = `the most recently used heading that has them ("${donors[0].name || path.basename(donors[0].target.cwd)}")`;
        }
      }
      if (!source) {
        throw new StopError(`${label}: no heading has a remembered model yet, so there is nothing to copy. `
          + 'Start one session in any folder the usual way first, or pass --model <id> --effort <level>.');
      }
      for (const p of needs) {
        const key = placeKey(p);
        const own = hasSettings(pd[key]) ? pd[key] : hasSettings(p.settings) ? p.settings : source;
        if (!hasSettings(p.settings)) p.settings = structuredClone(own);
        if (!hasSettings(pd[key])) pd[key] = structuredClone(own);
        filled.push(p.target.cwd);
      }
      notes.push(`model and effort for ${filled.length} heading(s) copied from ${sourceDesc}`);
      presetsChanged = true;
    }
  } else {
    const pd = doc.state.placeDefaults || {};
    const n = [...byCwd.values()].filter((p) => !hasSettings(p.settings) || !hasSettings(pd[`local::${p.target.cwd}`])).length;
    if (n) notes.push(`${n} heading(s) have no remembered model, so their "+" may fail; add --fill-settings to fix`);
  }

  // 3. Heading order (only where the app keeps a list; never create one).
  let newOrder = null;
  let oldOrder = null;
  let names = headingNames([...byCwd.keys()].map((cwd) => ({ cwd, presetName: byCwd.get(cwd).name })));
  if (!orderDoc) {
    notes.push('no heading-order list on this machine; Claude uses its own order, left alone');
    if (mirror) notes.push('a heading-order copy exists only in claude_desktop_config.json; left alone');
  } else {
    oldOrder = orderDoc.value;
    const seen = new Set();
    const all = [];
    for (const p of [...oldOrder, ...byCwd.keys()]) {
      const n = normPath(p);
      if (!seen.has(n)) { seen.add(n); all.push(oldOrder.includes(p) ? p : n); }
    }
    names = headingNames(all.map((cwd) => ({ cwd, presetName: byCwd.get(normPath(cwd))?.name })));
    const sorted = sortPaths(all, names);
    if (JSON.stringify(sorted) !== JSON.stringify(oldOrder)) newOrder = sorted;
  }

  let mirrorOut = null;
  if (newOrder && mirror) mirrorOut = mirror.wrapped ? { ...input.mirrorValue, value: newOrder } : newOrder;

  return {
    label,
    notes,
    presetsText: presetsChanged ? JSON.stringify(doc) : null,
    orderText: newOrder ? JSON.stringify({ ...orderDoc, value: newOrder }) : null,
    mirror: mirrorOut,
    oldOrder,
    newOrder,
    names,
    added: added.map((p) => ({ cwd: p.target.cwd, name: p.name })),
    filled,
  };
}

module.exports = { planAccount, headingNames, sortPaths, parsePresets, parseOrder, normPath, toMs };
