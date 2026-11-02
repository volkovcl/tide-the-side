'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Fixture, preset, SETTINGS } = require('./helpers');

function withFixture(fn) {
  return async () => {
    const f = new Fixture();
    try { await fn(f); } finally { f.cleanup(); }
  };
}

test('order list present: sorted A to Z, case-insensitive, numbers in order', withFixture(async (f) => {
  const z = f.folder('Zebra'); const a = f.folder('alpha'); const m = f.folder('Mango');
  const p10 = f.folder('item 10'); const p9 = f.folder('item 9');
  const presets = [z, a, m, p10, p9].map((p) => preset(p, { settings: SETTINGS() }));
  const pd = Object.fromEntries([z, a, m, p10, p9].map((p) => [`local::${p}`, SETTINGS()]));
  await f.setup({ presets, placeDefaults: pd, order: [z, m, a, p10, p9], mirror: { value: [z, m, a, p10, p9] } });

  const before = await f.dump();
  const plan = f.run(['plan']);
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /Heading order, A to Z/);
  assert.equal(await f.dump(), before, 'plan must not write');
  assert.deepEqual(f.backups(), []);

  const r = f.run(['apply']);
  assert.equal(r.code, 0, r.err);
  const want = [a, p9, p10, m, z];
  assert.deepEqual(await f.order(), want);
  assert.deepEqual(f.config().preferences.epitaxyPrefs[`code-projects-order.${f.account}`], { value: want });
  assert.equal(f.backups().length, 1);

  const again = f.run(['apply']);
  assert.equal(again.code, 0);
  assert.match(again.out, /Nothing to change/);
  assert.equal(f.backups().length, 1, 'no backup when nothing changes');
}));

test('order list absent: left alone, no list created', withFixture(async (f) => {
  const z = f.folder('Zebra'); const a = f.folder('alpha');
  await f.setup({ presets: [preset(z), preset(a)] });
  const r = f.run(['apply']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no heading-order list/);
  assert.equal(await f.read(f.orderKey()), null);
}));

test('a new folder drawn at the bottom is slotted into place', withFixture(async (f) => {
  const a = f.folder('apple'); const c = f.folder('cherry'); const b = f.folder('banana');
  await f.setup({ presets: [preset(a), preset(c), preset(b)], order: [a, c] });
  const r = f.run(['apply']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(await f.order(), [a, b, c]);
}));

test('a folder with sessions but no heading is added only when asked', withFixture(async (f) => {
  const a = f.folder('apple'); const c = f.folder('cherry'); const b = f.folder('banana');
  const gone = path.join(f.root, 'w', 'deleted-folder');
  await f.setup({ presets: [preset(a), preset(c)], order: [a, c] });
  f.session(b); f.session(b); f.session(gone);
  f.session(f.folder('archived-only'), { isArchived: true });

  const plain = f.run(['apply']);
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /1 folder\(s\) with sessions have no heading/);
  assert.equal((await f.presets()).state.presets.length, 2);

  const r = f.run(['apply', '--add-headings']);
  assert.equal(r.code, 0, r.err);
  const doc = await f.presets();
  const added = doc.state.presets.filter((p) => p.target.cwd === b);
  assert.equal(added.length, 1);
  assert.match(added[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(typeof added[0].createdAt, 'number');
  assert.equal(added[0].name, 'banana');
  assert.equal(doc.state.presets.length, 3, 'deleted and archived-only folders not added');
  assert.equal(doc.state.presets[0].target.cwd, a, 'existing setups keep their place');
  assert.deepEqual(await f.order(), [a, b, c]);
  assert.equal(doc.version, 4);
  assert.equal(doc.state.seededFromHistory, 2, 'other fields untouched');
  // the roaming key is untouched
  assert.deepEqual(JSON.parse(await f.read(`${f.presetsKey()}.${f.org}`)).state.presets, []);
}));

test('missing settings are filled only with --fill-settings, copied from the most recent donor', withFixture(async (f) => {
  const a = f.folder('apple'); const b = f.folder('banana'); const c = f.folder('cherry');
  const older = preset(a, { lastUsedAt: 1000, settings: SETTINGS('model-old', 'low') });
  const newer = preset(b, { lastUsedAt: 2000, settings: SETTINGS('model-new', 'high') });
  const bare = preset(c);
  await f.setup({ presets: [older, newer, bare], placeDefaults: { [`local::${a}`]: SETTINGS('model-old', 'low'), [`local::${b}`]: SETTINGS('model-new', 'high') } });

  const plain = f.run(['apply']);
  assert.equal(plain.code, 0, plain.err);
  assert.match(plain.out, /no remembered model/);
  assert.equal((await f.presets()).state.presets[2].settings, undefined);

  const r = f.run(['apply', '--fill-settings']);
  assert.equal(r.code, 0, r.err);
  const doc = await f.presets();
  assert.deepEqual(doc.state.presets[2].settings, SETTINGS('model-new', 'high'));
  assert.deepEqual(doc.state.placeDefaults[`local::${c}`], SETTINGS('model-new', 'high'));
  assert.deepEqual(doc.state.presets[0].settings, SETTINGS('model-old', 'low'), 'existing settings untouched');
}));

test('--fill-settings with no donor stops and writes nothing; explicit --model works', withFixture(async (f) => {
  const a = f.folder('apple');
  await f.setup({ presets: [preset(a)] });
  const before = await f.dump();
  const r = f.run(['apply', '--fill-settings']);
  assert.equal(r.code, 2);
  assert.match(r.err, /nothing to copy/);
  assert.equal(await f.dump(), before);

  const ok = f.run(['apply', '--fill-settings', '--model', 'model-x', '--effort', 'medium']);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual((await f.presets()).state.presets[0].settings, { modelId: 'model-x', effort: 'medium', fastMode: false });
}));

test('Claude running: apply and restore refuse', withFixture(async (f) => {
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  await f.setup({ presets: [preset(a), preset(b)], order: [a, b] });
  assert.equal(f.run(['apply']).code, 0);
  const [backupName] = f.backups();
  await f.writeStore({ [f.orderKey()]: JSON.stringify({ value: [a, b] }) });
  const standIn = spawn('/bin/sleep', ['3607']);
  try {
    await new Promise((r) => setTimeout(r, 200));
    const before = await f.dump();
    const r = f.run(['apply'], { TTS_APP_MATCH: '/bin/sleep 3607' });
    assert.equal(r.code, 3);
    assert.match(r.err, /Claude is open/);
    assert.equal(await f.dump(), before);
    const p = f.run(['plan'], { TTS_APP_MATCH: '/bin/sleep 3607' });
    assert.equal(p.code, 0, 'plan still works from a snapshot');
    assert.match(p.out, /snapshot/);
    const rr = f.run(['restore', backupName], { TTS_APP_MATCH: '/bin/sleep 3607' });
    assert.equal(rr.code, 3);
    assert.equal(await f.dump(), before);
  } finally {
    standIn.kill();
  }
}));

test('a live write lock makes apply refuse; a stale one is ignored', withFixture(async (f) => {
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  await f.setup({ presets: [preset(a), preset(b)], order: [a, b] });
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(path.join(f.home, 'write.lock'), String(process.pid));
  const r = f.run(['apply']);
  assert.equal(r.code, 3);
  assert.match(r.err, /another write is in progress/);

  const dead = spawnSync('/usr/bin/true').pid;
  fs.writeFileSync(path.join(f.home, 'write.lock'), String(dead));
  const ok = f.run(['apply']);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(await f.order(), [b, a]);
  assert.equal(fs.existsSync(path.join(f.home, 'write.lock')), false);
}));

test('unexpected value prefix: stop, nothing written', withFixture(async (f) => {
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  const bad = Buffer.concat([Buffer.from([0x02]), Buffer.from('{}', 'latin1')]);
  await f.setup({ presets: [preset(a), preset(b)], order: [a, b] });
  await f.writeStore({ [f.presetsKey()]: bad });
  const before = await f.dump();
  const r = f.run(['apply']);
  assert.equal(r.code, 2);
  assert.match(r.err, /starts with byte 0x02/);
  assert.equal(await f.dump(), before);
}));

test('unexpected JSON shape or version: stop, nothing written', withFixture(async (f) => {
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  const doc = { state: { presets: [preset(a), preset(b)], placeDefaults: {} }, version: 5 };
  await f.setup({ rawPresets: JSON.stringify(doc), order: [a, b] });
  const before = await f.dump();
  const r = f.run(['apply']);
  assert.equal(r.code, 2);
  assert.match(r.err, /version 5/);
  assert.equal(await f.dump(), before);

  await f.writeStore({ [f.presetsKey()]: JSON.stringify({ state: { presets: 'nope' }, version: 4 }) });
  const r2 = f.run(['apply']);
  assert.equal(r2.code, 2);

  await f.writeStore({ [f.presetsKey()]: JSON.stringify({ state: { presets: [preset(a)] }, version: 4 }), [f.orderKey()]: JSON.stringify([a]) });
  const r3 = f.run(['apply']);
  assert.equal(r3.code, 2);
  assert.match(r3.err, /heading order is not/);
}));

test('duplicate or generic folder names get " (parent)"', withFixture(async (f) => {
  const x = f.folder('zeta', 'site'); const y = f.folder('beta', 'site'); const w = f.folder('gamma', 'workspace');
  const presets = [preset(x, { name: undefined }), preset(y, { name: undefined }), preset(w, { name: undefined })];
  await f.setup({ presets, order: [x, y, w] });
  const r = f.run(['plan']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /site \(beta\)/);
  assert.match(r.out, /site \(zeta\)/);
  assert.match(r.out, /workspace \(gamma\)/);
  f.run(['apply']);
  assert.deepEqual(await f.order(), [y, x, w]);
}));

test('non-latin folder names round-trip as UTF-16', withFixture(async (f) => {
  const cyr = f.folder('Проект'); const lat = f.folder('Alpha');
  await f.setup({ presets: [preset(cyr), preset(lat)], order: [cyr, lat] });
  const r = f.run(['apply']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(await f.order(), [lat, cyr]);
}));

test('restore puts the store and the order copy back', withFixture(async (f) => {
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  await f.setup({ presets: [preset(a), preset(b)], order: [a, b], mirror: [a, b] });
  const r = f.run(['apply']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(await f.order(), [b, a]);
  assert.deepEqual(f.config().preferences.epitaxyPrefs[`code-projects-order.${f.account}`], [b, a], 'bare-list mirror stays a bare list');
  const [name] = f.backups();
  const rr = f.run(['restore', name]);
  assert.equal(rr.code, 0, rr.err);
  assert.deepEqual(await f.order(), [a, b]);
  assert.deepEqual(f.config().preferences.epitaxyPrefs[`code-projects-order.${f.account}`], [a, b]);
  assert.equal(f.backups().length, 2, 'a safety backup was taken');
}));

test('backups are pruned to --keep', withFixture(async (f) => {
  const names = ['d', 'c', 'b', 'a'].map((n) => f.folder(n));
  await f.setup({ presets: names.map((p) => preset(p)), order: names });
  for (let i = 0; i < 4; i++) {
    await f.writeStore({ [f.orderKey()]: JSON.stringify({ value: names }) });
    assert.equal(f.run(['apply', '--keep', '2']).code, 0);
  }
  assert.equal(f.backups().length, 2);
}));
