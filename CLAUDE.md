# Inventru - working rules

Inventru is a Windows store-room stock app with three parts: an Electron app on the store-room PC, a single-exe Node
server on a VM (optional - the app also has a "Just this PC" mode), and a browser TV dashboard served by the server.
The file map is in ABOUT.md under "Where things are"; read it before larger changes.

The owner runs IT equipment in a store room and is not a developer. Explain changes in plain words, without jargon.
Ask before big or hard-to-undo changes; otherwise just get on with it.

## Rules that must not drift

- **Names** (used for easy identification on a corporate network): folders the program creates are `inventrustock-app`
  and `inventrustock-server` (Program Files, ProgramData, AppData); executables are `Inventru.exe` and
  `InventruServer.exe`; the scheduled task and the firewall rule are both called `Inventru server`.
- **Nothing to install first**: no runtimes, accounts, cloud or internet on the target PCs/VM, and no outbound
  connections. Don't add runtime dependencies - `package.json` has dev dependencies only (Electron, electron-builder).
- **The TV dashboard and setup page must work in old browsers** (Chromium 61 / Safari 11 / Firefox 60; the setup page
  works without JavaScript too). `test/compat.test.js` enforces this.
- **Corporate safety**: keep the Electron lock-down (fuses in `scripts/after-pack.js`, window restrictions in
  `src/main/main.js`). Anything the installer changes on Windows must be listed in ABOUT.md under
  "What the permission prompt changes", and uninstall must undo it (user data is kept).
- **Existing data must keep working**: users update by installing over the top, so a new version must read the stock
  list, change log, backups and settings written by older versions.

## Making a change

1. Change the code; add or update tests in `test/` (unit: `npm test`; everything: `npm run test:all`).
2. Update the docs where what the user sees changes: README.md (non-technical, step by step), docs/IT.md (for IT),
   ABOUT.md (how it works, what it changes).
3. For a release: bump the version in **both** `package.json` and `VERSION` in `server/server.js` (a test checks they
   match), and add an entry at the top of CHANGELOG.md written for the user (what changed for them, not how).
4. Run `npm run dist` before handing over any build. It runs the icon, all tests, the app installer build, the server
   build, checks on the finished programs and makes `dist/Inventru-<version>.zip`. Only hand over a zip if it passes.
5. Commit with Git and tag releases as `v<version>` (e.g. `v1.0.1`).

## Upkeep

- Keep Electron (pinned in `package.json`) up to date for security fixes; rebuild and run `npm run dist` afterwards.
- `InventruServer.exe` is built from the Node.js installed on the build PC (Node single-executable application), so
  updating Node and rebuilding picks up Node's security fixes.
- The older "Stock Tracker" code in `..\inventoriapp` is kept for reference only; don't change it.
