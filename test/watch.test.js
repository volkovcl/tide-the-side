'use strict';

// The quit watcher, with /bin/sleep standing in for Claude.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Fixture, preset } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario({ lockPid, secs }) {
  const f = new Fixture();
  const match = `/bin/sleep ${secs}`;
  const a = f.folder('b-folder'); const b = f.folder('a-folder');
  await f.setup({ presets: [preset(a), preset(b)], order: [a, b] });
  const standIn = spawn('/bin/sleep', [String(secs)]);
  await sleep(200);
  const watcher = f.spawn(['watch', 'run'], { TTS_APP_MATCH: match });
  const events = [];
  let buf = '';
  watcher.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { events.push({ at: Date.now(), ...JSON.parse(line) }); } catch { /* ignore */ }
    }
  });
  try {
    while (!events.some((e) => e.event === 'started')) await sleep(50);
    assert.equal(events[0].claudeRunning, true);
    await sleep(1500);
    assert.deepEqual(events.map((e) => e.event), ['started'], 'nothing happens while Claude is open');
    if (lockPid) {
      fs.mkdirSync(f.home, { recursive: true });
      fs.writeFileSync(path.join(f.home, 'write.lock'), String(lockPid));
    }
    const quitAt = Date.now();
    standIn.kill();
    const acted = () => events.filter((e) => ['applied', 'yielded', 'nothing-to-do', 'stopped', 'error'].includes(e.event));
    while (!acted().length && Date.now() - quitAt < 6000) await sleep(50);
    await sleep(2500); // time for a second (wrong) firing
    return { f, quitAt, actions: acted(), events };
  } finally {
    watcher.kill();
  }
}

test('watcher fires once per quit, about 1 to 1.5 s after it, and sorts', async () => {
  const { f, quitAt, actions } = await scenario({ secs: 3611 });
  try {
    assert.equal(actions.length, 1, JSON.stringify(actions));
    assert.equal(actions[0].event, 'applied');
    const delay = actions[0].at - quitAt;
    assert.ok(delay >= 900 && delay <= 2600, `fired ${delay} ms after the quit`);
    const order = await f.order();
    assert.equal(path.basename(order[0]), 'a-folder');
  } finally { f.cleanup(); }
});

test('watcher yields to a live write lock', async () => {
  const { f, actions } = await scenario({ secs: 3612, lockPid: process.pid });
  try {
    assert.equal(actions.length, 1);
    assert.equal(actions[0].event, 'yielded');
    assert.equal(path.basename((await f.order())[0]), 'b-folder', 'nothing written');
  } finally { f.cleanup(); }
});

test('watcher ignores a stale lock (dead pid)', async () => {
  const dead = spawnSync('/usr/bin/true').pid;
  const { f, actions } = await scenario({ secs: 3613, lockPid: dead });
  try {
    assert.equal(actions.length, 1);
    assert.equal(actions[0].event, 'applied');
    assert.equal(fs.existsSync(path.join(f.home, 'write.lock')), false);
  } finally { f.cleanup(); }
});

test('the LaunchAgent text carries the chosen options and no personal paths beyond this install', () => {
  const { plistText, LABEL } = require('../lib/watch');
  const t = plistText(['--fill-settings']);
  assert.match(t, new RegExp(`<string>${LABEL.replace(/\./g, '\\.')}</string>`));
  assert.match(t, /<string>watch<\/string>\s*<string>run<\/string>\s*<string>--fill-settings<\/string>/);
  assert.match(t, /<key>KeepAlive<\/key>\s*<true\/>/);
});
