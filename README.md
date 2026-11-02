# tide-the-side

**Sorts the headings in the Claude desktop app's Code sidebar A to Z, on macOS.**

> Unofficial. Not made by, endorsed by or affiliated with Anthropic. It changes files inside the Claude app's
> own data folder in ways the app does not document. It comes with no warranty (see [LICENSE.txt](LICENSE.txt)).
> It always makes a backup first, and one command puts the backup back.

## Why

Since a redesign in October 2026, the Code tab of the Claude desktop app draws one sidebar heading per
"saved setup". On many machines:

- new or renamed folders appear at the **bottom** of the sidebar instead of in alphabetical order;
- many folders have **no heading of their own** and are lumped together;
- the **"+"** on a heading fails with *"Couldn't switch environments: the Local environment isn't available
  anymore"* when that heading has no remembered model.

The app has no setting for any of this. This tool fixes all three, each only when you ask.

## What it does

| | What | When |
|---|---|---|
| 1 | Puts the headings in A to Z order (ignoring case; "item 9" before "item 10"). New folders are slotted into place. | always (`apply`) |
| 2 | Adds a heading for each folder that has sessions but no heading. | only with `--add-headings` |
| 3 | Gives headings that lack one a remembered model and effort, so "+" works. It copies them from your most recently used heading that has them; it never makes one up. | only with `--fill-settings` |
| 4 | Re-sorts every time you quit Claude, so new folders are in place at the next start. | only if you install the watcher |

What it never does: remove, rename or reorder your own saved setups; touch cloud or SSH setups; create an order
list where the app keeps none (on such Macs Claude uses its own order and this tool leaves it alone); send
anything anywhere. It makes no network connections and collects nothing.

## Works with

The tool does not trust version numbers. Every time it runs, it checks each piece of the app's data it relies
on, and if anything is different it stops with a message and writes nothing. So on an untested version the worst
case is a refusal, not damage. Run `plan` first: if it shows a plan, your version is understood.

What has been checked so far:

| Claude app version | Mac | What was checked | Result |
|---|---|---|---|
| 4.4212.0 | macOS 27.0, Apple Silicon | `plan` (dry run) on a real account | Saved headings read correctly. That Mac keeps no heading-order list, so there was nothing to sort. |
| October 2026 releases | macOS 26.7.1, and one other Mac | the same reads and writes, done by an earlier private script | headings sorted A to Z as expected |
| any | any Mac | the full test suite, on made-up data | all pass |

Not yet confirmed with this tool itself on a real account: the sort (`apply` on a Mac that has a heading-order
list) and the quit watcher. If you try it, please report your Claude version and what happened in the
[issues](https://github.com/volkovcl/tide-the-side/issues). To see your version: in Claude, choose
**Claude > About Claude**, or run `node bin/tide-the-side.js --version`.

## You need

- macOS (Apple Silicon or Intel). Not Windows or Linux.
- The Claude desktop app, with its Code tab used at least once.
- [Node.js](https://nodejs.org) 18 or newer.

## Install

1. **Check for Node.js.** Open the Terminal app (in Applications > Utilities) and type:

   ```bash
   node --version
   ```

   If it prints `v18` or higher, go on. If it says `command not found`, install the LTS version from
   <https://nodejs.org> (the macOS installer), or with Homebrew: `brew install node`. Then open a new Terminal
   window and check again.

2. **Download tide-the-side.** From the [latest release](https://github.com/volkovcl/tide-the-side/releases/latest),
   download `tide-the-side-<version>.zip` and unzip it. Move the `tide-the-side` folder somewhere it can stay,
   for example your home folder. If you plan to use the quit watcher, keep it out of iCloud Drive, Dropbox and
   similar folders.

3. **Install its one library.** In Terminal, type `cd ` (with a space), drag the `tide-the-side` folder onto
   the Terminal window, press Return, then:

   ```bash
   npm ci --ignore-scripts
   ```

   This installs `classic-level` (pinned to version 1.4.1), the library that reads and writes the app's storage.
   It comes with a ready-made macOS binary, so nothing is compiled and no install scripts run.

4. **Check it runs:**

   ```bash
   node bin/tide-the-side.js --version
   ```

   It prints the tool's version and your Claude app's version.

All commands below are typed in Terminal, inside the `tide-the-side` folder.

## Use

**1. See what would change.** This changes nothing and works while Claude is open:

```bash
node bin/tide-the-side.js plan
```

It lists the headings in their new order, shows each one's old position, and says what else it noticed.

**2. Quit Claude fully** with **Cmd+Q** (closing the window is not enough). The tool refuses to write while
Claude is open.

**3. Make the changes:**

```bash
node bin/tide-the-side.js apply
```

**4. Open Claude again.** The headings are in A to Z order.

### The two optional fixes

Add either or both to `plan` (to preview) and to `apply`:

```bash
node bin/tide-the-side.js apply --add-headings --fill-settings
```

- `--add-headings` adds a heading for each folder that has sessions but no heading. Folders that no longer exist
  and archived-only folders are skipped.
- `--fill-settings` gives headings without a remembered model the model and effort of your most recently used
  heading. If no heading has one yet, it stops and asks you to start one session the usual way first, or to
  name them yourself: `--fill-settings --model <model id> --effort <level>`.

### What the messages mean

| Message | Meaning |
|---|---|
| `Heading order, A to Z:` followed by a list | This is the new order; `(was 3)` shows a heading's old place, `(new)` a heading added to the list. |
| `Nothing to change.` | Already tidy. Nothing written, no backup made. |
| `no heading-order list on this machine` | This Mac's Claude keeps no order list. Claude uses its own order and the tool leaves it alone. The two optional fixes still work. |
| `stopped, nothing written: Claude is open` | Quit Claude with Cmd+Q and try again. |
| `stopped, nothing written:` anything else | Something in the app's data is not as expected, often after a Claude update. Nothing was changed. Please report the message in the issues. |
| `Done. Backup: <name>` | Written. The backup name is what `restore` needs. |

### Undo

Every `apply` first saves a full copy of the app's storage (about 0.03 s, using almost no extra disk space). The
last 10 are kept (`--keep <n>` to change that). To list them and put one back (quit Claude first):

```bash
node bin/tide-the-side.js backups
```

```bash
node bin/tide-the-side.js restore <backup name>
```

`restore` also saves the current state first, so a restore can be undone too.

### Re-sort every time Claude quits (optional)

```bash
node bin/tide-the-side.js watch install
```

This adds a small background job (a LaunchAgent) that checks about twice a second whether Claude is running.
About a second after Claude quits, if it is still closed, it re-sorts. Add `--add-headings` or
`--fill-settings` to `watch install` and the job uses them too. Run this from the Terminal app: inside Claude
Code, writing to `~/Library/LaunchAgents` may be blocked.

```bash
node bin/tide-the-side.js watch status
```

```bash
node bin/tide-the-side.js watch uninstall
```

The job's log is at `~/Library/Application Support/tide-the-side/watch.log`.

### Remove it completely

```bash
node bin/tide-the-side.js watch uninstall
```

Then delete the `tide-the-side` folder you downloaded, and, if you no longer want the backups,
`~/Library/Application Support/tide-the-side`. Your sidebar keeps the order it has; Claude may change it again
from then on.

## Risks, and how it limits them

- **The format is undocumented and can change with any Claude update.** The tool checks every key, value type,
  JSON shape and version number it relies on. If anything is not exactly as expected, it stops with a message and
  writes nothing. It never guesses.
- **Writing while Claude runs could lose data.** `apply` and `restore` refuse while Claude is open, and the
  app locks its storage while it runs.
- **Two writers at once.** A short-lived lock file keeps a manual run and the watcher from writing together.
- **A bad write.** Every write is read back and compared, and a full backup is taken before every write.

## Where it writes

| Path | What |
|---|---|
| `~/Library/Application Support/Claude/Local Storage/leveldb` | the app's storage: two entries, saved setups and heading order |
| `~/Library/Application Support/Claude/claude_desktop_config.json` | only the app's copy of the heading order, and only if it exists |
| `~/Library/Application Support/tide-the-side/` | this tool's backups, lock file and watcher log |
| `~/Library/LaunchAgents/local.tide-the-side.watch.plist` | the watcher, only if you install it |

## How it works

The Code sidebar's state lives in the app's browser storage (Chromium localStorage, a LevelDB database).
Two entries matter, per signed-in account:

- `persisted.ccd-session-presets.<account>`: the saved setups, one heading each, plus the remembered model and
  effort per folder (`placeDefaults`);
- `LSS-persisted.code-projects-order.<account>`: a list of folder paths in the order the headings are drawn.
  A folder missing from the list is drawn at the bottom. Not every Mac has this list.

The file `ccd-session-presets.json` next to them is only a copy the app overwrites at each start; editing it has
no effect. Folders with sessions are found in `claude-code-sessions/`.

## Tests

```bash
npm test
```

The tests build made-up storage in a temporary folder; no real user data is used.

## License

Free to use, copy, change and share. It may not be sold, nor may a product or service whose value comes mainly
from it. The terms are the MIT License with the Commons Clause: see [LICENSE.txt](LICENSE.txt).
Copyright (c) 2026 Aleksandr A. Volkov.
