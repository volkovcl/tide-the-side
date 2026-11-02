#!/usr/bin/env node
'use strict';

const path = require('path');

const HELP = `tide-the-side: sort the Claude desktop app's Code sidebar headings A to Z (macOS only).
Unofficial; not affiliated with Anthropic. No network use.

Usage:
  tide-the-side [plan] [options]      show what would change (the default; changes nothing)
  tide-the-side apply [options]       make the changes (Claude must be fully quit)
  tide-the-side backups               list backups
  tide-the-side restore <backup>      put a backup back (Claude must be fully quit)
  tide-the-side watch install [options]   re-sort every time Claude quits (a LaunchAgent)
  tide-the-side watch uninstall
  tide-the-side watch status

Options:
  --add-headings      add a heading for each folder that has sessions but no heading
  --fill-settings     give headings that lack one a remembered model and effort, so "+" works
                      (copied from your most recently used heading that has them)
  --model <id> --effort <level> [--fast]
                      use these for --fill-settings instead of copying
  --include-archived  count archived sessions when looking for folders
  --keep <n>          backups to keep (default 10)
  -v, --version       this tool's version and the Claude app's version
  -h, --help
`;

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
    switch (a) {
      case '--add-headings': out.opts.addHeadings = true; break;
      case '--fill-settings': out.opts.fillSettings = true; break;
      case '--model': out.opts.model = next(); break;
      case '--effort': out.opts.effort = next(); break;
      case '--fast': out.opts.fast = true; break;
      case '--include-archived': out.opts.includeArchived = true; break;
      case '--keep': out.opts.keep = parseInt(next(), 10); if (!(out.opts.keep >= 1)) fail('--keep needs a number of 1 or more'); break;
      case '-h': case '--help': out.help = true; break;
      case '-v': case '--version': out.version = true; break;
      default:
        if (a.startsWith('-')) fail(`unknown option ${a}`);
        out._.push(a);
    }
  }
  return out;
}

// Options as they would be typed again (for the watcher's saved command line).
function optsToArgs(o) {
  const a = [];
  if (o.addHeadings) a.push('--add-headings');
  if (o.fillSettings) a.push('--fill-settings');
  if (o.model) a.push('--model', o.model);
  if (o.effort) a.push('--effort', o.effort);
  if (o.fast) a.push('--fast');
  if (o.includeArchived) a.push('--include-archived');
  if (o.keep) a.push('--keep', String(o.keep));
  return a;
}

function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function printPlans(plans, { applied } = {}) {
  for (const p of plans) {
    console.log(`\n== ${p.label} ==`);
    if (p.newOrder) {
      console.log(applied ? 'Heading order, now:' : 'Heading order, A to Z:');
      const oldIdx = new Map(p.oldOrder.map((c, i) => [c, i]));
      p.newOrder.forEach((cwd, i) => {
        const was = oldIdx.has(cwd) ? (oldIdx.get(cwd) === i ? '' : `  (was ${oldIdx.get(cwd) + 1})`) : '  (new)';
        console.log(`  ${String(i + 1).padStart(3)}. ${p.names.get(cwd) || path.basename(cwd)}${was}`);
      });
    } else if (p.oldOrder) {
      console.log('Heading order: already A to Z.');
    }
    for (const a of p.added) console.log(`${applied ? 'Added' : 'Would add'} heading "${a.name}" for ${a.cwd}`);
    for (const n of p.notes) console.log(`- ${n}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const { claudeVersion } = require('../lib/claude');
  if (args.version) {
    console.log(`tide-the-side ${require('../package.json').version}; Claude app ${claudeVersion() || 'not found'}`);
    return;
  }
  if (process.platform !== 'darwin' && !process.env.TTS_APP_SUPPORT) fail('this tool works only on macOS');

  const tidy = require('../lib/tidy');
  const cmd = args._[0] || 'plan';

  const appVersion = claudeVersion();
  if (appVersion && ['plan', 'apply'].includes(cmd)) console.log(`Claude app version ${appVersion}`);

  if (cmd === 'plan') {
    const { plans, claudeRunning } = await tidy.plan(args.opts);
    printPlans(plans);
    console.log(tidy.hasChanges(plans)
      ? `\nNothing was changed. To make these changes, quit Claude fully (Cmd+Q) and run: apply${optsToArgs(args.opts).map((x) => ' ' + x).join('')}`
      : '\nNothing to change.');
    if (claudeRunning) console.log('(Claude is open, so this was read from a snapshot.)');
    return;
  }
  if (cmd === 'apply') {
    const r = await tidy.apply(args.opts);
    printPlans(r.plans, { applied: r.wrote });
    console.log(r.wrote ? `\nDone. Backup: ${r.backup}  (undo with: restore ${r.backup})` : '\nNothing to change; nothing written.');
    return;
  }
  if (cmd === 'backups') {
    const list = require('../lib/backup').listBackups();
    if (!list.length) console.log('No backups yet.');
    for (const b of list) console.log(`${b.name}  ${b.reason}`);
    return;
  }
  if (cmd === 'restore') {
    if (!args._[1]) fail('which backup? Run "backups" to list them.');
    const r = await tidy.restore(args._[1], args.opts);
    console.log(`Restored ${args._[1]}. The state just before this restore was saved as ${r.safety}.`);
    return;
  }
  if (cmd === 'watch') {
    const w = require('../lib/watch');
    const sub = args._[1];
    if (sub === 'run') return w.runWatcher(args.opts);
    if (sub === 'install') { const r = w.install(optsToArgs(args.opts)); console.log(r.message); if (!r.ok) process.exit(1); return; }
    if (sub === 'uninstall') { const r = w.uninstall(); console.log(r.message); if (!r.ok) process.exit(1); return; }
    if (sub === 'status') {
      const s = w.status();
      console.log(`installed: ${s.installed ? 'yes' : 'no'}; running: ${s.loaded ? 'yes' : 'no'}`);
      if (s.tail) console.log(`last log lines:\n${s.tail}`);
      return;
    }
    fail('watch needs one of: install, uninstall, status');
  }
  fail(`unknown command ${cmd}; try --help`);
}

main().catch((e) => {
  if (e && (e.name === 'StopError' || e.name === 'BusyError')) {
    process.stderr.write(`stopped, nothing written: ${e.message}\n`);
    process.exit(e.exitCode);
  }
  process.stderr.write(`error: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
