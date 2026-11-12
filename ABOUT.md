# About Inventru

Inventru 1.0 has two programs. Both are written in **JavaScript**, with the screens in **HTML** and **CSS**.
Each one ships with everything it needs built in, so nothing has to be installed first.

|                             | The app (store-room PC)                                              | The server (VM)                         |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------- |
| File you run                | `Inventru-Setup-1.0.0.exe` (installer)                               | `InventruServer.exe` (one file)         |
| Written in                  | JavaScript, HTML, CSS                                                | JavaScript                              |
| Runs on                     | **Electron 45.2** - Chromium 156 + Node.js 24.22, built into the app | **Node.js 26.13**, built into the .exe  |
| Libraries used when running | none (only what Electron and Node.js include)                        | none (only Node.js's own modules)       |
| Size                        | about 116 MB installer                                               | about 96 MB                             |
| Windows                     | Windows 10 / 11, 64-bit                                              | Windows 10 / 11 or Server 2016+, 64-bit |
| Needs administrator rights  | no                                                                   | yes, once, to install (see below)       |

The server is optional: in **Just this PC** mode the app keeps the stock list itself, on the PC, and nothing else is
installed.

The **TV dashboard** and the server's **setup page** are web pages (HTML, CSS, JavaScript) that the server sends to the
browser. They don't use any outside libraries, fonts or websites.


## What the permission prompt changes

Only the **server** asks for permission (Windows' *"Do you want to allow this app to make changes to your device?"*,). The app never does. Here is everything that happens after you click **Yes**.

### Installing the server (double-click the first time, or `InventruServer.exe --install`)

1. **Copies the program** to `C:\Program Files\inventrustock-server\InventruServer.exe`.
   While installing it also writes a temporary `task.xml` there and deletes it again.
2. **Creates the data folder** `C:\ProgramData\inventrustock-server\`, owned by Administrators, and limits who can
   open it to SYSTEM and Administrators (permissions inherited from `C:\ProgramData` are removed). Ordinary users
   can't read or change the stock list or the list of paired PCs.
3. **Adds a Windows Firewall rule** named **Inventru server**: allows incoming TCP connections on the server's port
   (8080, or the next free one up to 8099), only to `InventruServer.exe`, and only on *Domain* and *Private* networks
   (not *Public*).
4. **Adds a Task Scheduler task** named **Inventru server**: runs
   `InventruServer.exe --run --data "C:\ProgramData\inventrustock-server"` when the computer starts, as SYSTEM, with no
   time limit, and restarts it a minute later if it ever stops.
5. **Starts the task**, and waits until the server answers.

It does **not**: install a Windows service or driver, write to the registry itself, change PATH or any Windows setting,
add anything to the Start menu or to Settings > Apps, or connect to the internet.

### Updating the server (double-click a newer `InventruServer.exe`)

The same prompt. It stops the task, waits for the old server to close, replaces the program file, and sets up steps 2-5
again with the **same port**. The stock list, paired PCs, change log and backups are kept.

### Removing the server (`InventruServer.exe --uninstall`)

The same prompt. It stops and deletes the **Inventru server** task, deletes the **Inventru server** firewall rule and
deletes `C:\Program Files\inventrustock-server`. It keeps `C:\ProgramData\inventrustock-server` (your stock data) -
delete that folder too if you want everything gone.

### The app: no prompt

`Inventru-Setup-1.0.0.exe` installs for the signed-in Windows user only, so it never needs administrator rights.

|                                                                                                                                      | Where                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| The program                                                                                                                          | `C:\Users\<you>\AppData\Local\Programs\inventrustock-app\`                               |
| Shortcuts named *Inventru*                                                                                                           | Desktop and Start menu                                                                   |
| Its entry in Settings > Apps (*Inventru 1.0.0*)                                                                                      | two keys under `HKEY_CURRENT_USER\Software` (how to uninstall it, where it is installed) |
| When it runs: settings, the encrypted pairing token, a copy of the list (so it opens offline), changes waiting to be sent, `app.log` | `C:\Users\<you>\AppData\Roaming\inventrustock-app\`                                      |
| With *Just this PC*: the stock list, its change log and daily backups                                                                | `C:\Users\<you>\AppData\Roaming\inventrustock-app\stock\`                                |
| When it runs, if *Start when I sign in to Windows* is on (the default): a value named `Inventru`                                     | `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`                        |

Uninstalling (Settings > Apps > Inventru) removes the program, the shortcuts, the Apps entry and the `Inventru`
start-up value. It keeps `AppData\Roaming\inventrustock-app`, so reinstalling keeps the pairing (and a *Just this PC* list) -
delete that folder to remove everything.


## The app

* **[Electron](https://www.electronjs.org/)** is the technology behind Microsoft Teams (classic), VS Code and Slack:
  a desktop program whose window is drawn with web technology, with its own copy of the Chromium browser engine and of
  Node.js inside it. That's why the app doesn't need anything else installed - and why the installer is 116 MB.
  Version 45 is a currently supported Electron release that receives security fixes.
* **No UI framework** (no React, Angular, etc.). The screens are plain HTML, CSS and JavaScript, so there is
  nothing extra to keep up to date.
* The window is locked down: it can't reach the internet, other websites or other files on the PC, and has no access to
  Node.js. Only the app's own background part (Electron's "main process") talks to the server, and only to the one you
  paired with - directly, never through an internet proxy. With *Just this PC* it makes no network connections at all.
* The pairing token is encrypted with **Windows' own data protection (DPAPI)** through Electron's `safeStorage`, so
  only the same Windows user on the same PC can read it.
* **Electron features it never uses are switched off** inside `Inventru.exe` (Electron "fuses"): it can't be used to
  run other scripts (`ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS` and `--inspect` are ignored, and it only runs its own
  files, checked against a checksum built into the .exe - if they are changed, it won't start.
* The installer is made with **[electron-builder](https://www.electron.build/)** using **NSIS** (the Nullsoft installer).

## The server

* Plain **Node.js** using only its built-in modules (`http`, `fs`, `crypto`, `os`, `child_process`). No web framework
  (no Express etc.), no database engine.
* Packaged as a **Node.js single executable application (SEA)**: Node.js, the server code and the web pages are all
  inside `InventruServer.exe`. `NODE_OPTIONS` can't change how it runs.
* Installing uses tools that come with every copy of Windows: **PowerShell** (to ask for permission), **Task
  Scheduler** (`schtasks`), **Windows Firewall** (`netsh`) and `icacls` (to protect the data folder).
* Live updates to the TV use **Server-Sent Events**, a standard browser feature.
* It runs under a small watchdog that restarts it if it ever stops unexpectedly.

## How the data is stored

* On the server, in `C:\ProgramData\inventrustock-server\` - or with *Just this PC*, the same `data.json`, `log.csv`
  and `backups\` in the app's `stock\` folder, saved by the same code:
  * `data.json` - the stock list (**JSON**, a plain-text format)
  * `server.json` - its name, port and the paired PCs (only a fingerprint of each PC's key is kept)
  * `log.csv` - every change: time, item, change, new quantity, who (opens in Excel). When it reaches 10 MB it is kept
    as `log-<date>.csv` and a new one starts.
  * `backups\` - one copy of `data.json` per day, 30 days kept
  * `server.log` - when it started, PCs paired, problems
* Changes are sent as "+2" / "−1" rather than "the new total is 14", so two PCs changing the same item at once can't
  overwrite each other. Every change has an ID, and the server ignores any change it has already applied - so a change
  sent twice (for example after a network drop) still only counts once.
* Files are saved safely: written to a temporary file first, then swapped in, keeping the previous version as
  `.bak`. If a file is held by another program (for example antivirus), Inventru waits and tries again; it never carries on with
  an empty list instead. If the server can't save a change, it doesn't count it, and the PC sends it again.
* Import and export use **CSV** (comma-separated values) - a plain-text table any spreadsheet program can open.

## How it was checked

Every build (`npm run dist`) runs all of these, and stops if any fails:

* **108 automated tests** of the logic: counting, the offline queue, pairing, the server's rules and protections, CSV,
  settings, *Just this PC* (saving, the change log, a save that fails, a list file that can't be read), and that the
  web pages work in older browsers.
* **An automated walk-through of the app** (40 steps) that clicks every button and keyboard shortcut.
* **An end-to-end run**: a fresh copy of the app pairs with a real server, changes stock, sees a change made by another
  PC appear on its own, and reconnects by itself after a restart.
* **A run without a server**: a fresh copy of the app chooses *Just this PC* and is restarted, then moves its list to a
  server and back; and a PC using a server switches to *Just this PC*, keeping a copy of the list.
* **A real-browser run of the server's pages**: the setup page's buttons and CSV import, and the TV dashboard updating
  live, with no browser errors.
* **Checks of the finished programs**: names and versions, the switched-off Electron features, that a changed app file
  stops it starting, that `NODE_OPTIONS` can't inject code, the server's watchdog, and the end-to-end run again with
  the built app (with a server and with *Just this PC*).

Both programs were also checked to need only standard Windows system files (no Visual C++ runtime, .NET or similar),
and both were installed and removed for real on a Windows 11 PC: the app (install, run, uninstall - nothing left behind
except its settings folder) and the server (double-click install with the permission prompt, running as SYSTEM, update,
the locked-down data folder, removal - nothing left behind except its data folder).


## Building it from the source code

You need Windows and [Node.js](https://nodejs.org/) 26 or newer (only for building - not for running).

```
npm install
npm test                 # the automated tests
npm run test:e2e         # the app walk-through (with built-in demo data)
npm run test:e2e-server  # app + real server, end to end
npm run test:e2e-local   # the app with "Just this PC" (no server), end to end
npm run test:browser     # the server's setup page and TV dashboard in a real browser
npm run dist             # all of the above, then builds dist\Inventru-Setup-1.0.0.exe and
                         # dist-server\InventruServer.exe, then checks the built programs
npm run start:demo       # try the app with demo data, no server needed (only from the source code)
npm run server           # run a server from the source code (data in .\server-data)
```

Electron downloads its own runtime (about 160 MB) the first time it is used.

### Where things are

```
src/core/       the shared logic: counting, offline queue, talking to the server, the stock list on disk
                (stockbook.js - used by the server and by "Just this PC"), CSV, settings
src/main/       the app's background part (Electron main process)
src/renderer/   the app's window: index.html, styles.css, app.js, settings.js, dnd.js (drag and drop), icons.js
server/         the server: server.js (the web server and stock rules), cli.js (install, double-click behaviour)
server/web/     the TV dashboard and the setup page
build/          the icon and the installer's extra steps (installer.nsh)
test/           automated tests;  test/e2e/ the walk-throughs
scripts/        build and test helpers
```

### Only used while building (not shipped)

* `electron` - the Electron runtime that is copied into the installer
* `electron-builder` - makes the installer (it also gives `Inventru.exe` its name, version and icon)
* Node.js's own `--build-sea` - makes `InventruServer.exe`
