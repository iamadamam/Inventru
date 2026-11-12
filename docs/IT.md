# Inventru 1.0 - notes for IT

## What runs where

| Machine       | Software                                                                       | Runs as                                                                                    |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Server (VM)   | `InventruServer.exe` - one file, Node.js 26.13 built in, no other dependencies | Scheduled task *Inventru server*, at boot, as SYSTEM, restarts on failure, no time limit   |
| Store-room PC | Inventru app (Electron 45.2), per-user install, no admin rights needed         | The signed-in user                                                                         |
| TV            | Any browser                                                                    | -                                                                                          |

The server is optional. On first start the app asks for a server and pairing code, or **Just this PC**: the list is
then kept per Windows user in `%APPDATA%\inventrustock-app\stock\`, with no server, no TV dashboard and no network
connections. The choice can be changed later in the app's Settings (behind the PIN, if one is set). Moving from Just
this PC to a server copies the list only if the server's list is empty; moving the other way keeps a copy on the PC and
leaves the server unchanged (the PC's pairing token is deleted; remove the PC on the setup page if you like).

Everything Inventru creates is named **inventrustock-…** (folders) or **Inventru** (task, firewall rule, shortcuts,
Apps entry, start-up value). The exact list of changes is in [ABOUT.md](../ABOUT.md#what-the-permission-prompt-changes).

| | Server | App (per user) |
|---|---|---|
| Program | `C:\Program Files\inventrustock-server\` | `%LOCALAPPDATA%\Programs\inventrustock-app\` |
| Data | `C:\ProgramData\inventrustock-server\` (SYSTEM + Administrators only) | `%APPDATA%\inventrustock-app\` |
| Task Manager shows | *Inventru server* (`InventruServer.exe`, 2 processes: watchdog + server) | *Inventru* (`Inventru.exe`) |

## Network

* One inbound TCP port on the server, **8080** by default (next free port up to 8099 if taken; an update keeps the
  port). Firewall rule *Inventru server*, Domain and Private profiles, limited to the program. Add a *Remote IP* scope
  to the rule if you want to restrict who can connect.
* If the server's network is classed as **Public**, the rule doesn't apply and nothing can connect: the setup page
  and the install window say so. Set the network to Private (or join the domain).
* Plain HTTP on the internal network. The server makes **no outbound connections**; the app talks only to the
  configured server, directly (it ignores the internet proxy for this), and its window cannot make network requests
  or read other local files at all.
* Need HTTPS? Put the server behind your reverse proxy (IIS ARR / nginx) and enter the `https://` address in the app.

## Access

* **Viewing** (dashboard `/`, `/api/items`, `/api/export.csv`, live updates `/api/events`) is open to the network.
  At most 100 live connections at once.
* **Changing stock** needs a paired PC. Pairing: a 6-digit code, valid 30 minutes, one PC per code, closed after 5
  wrong tries. A code is only created when someone opens the setup page or clicks *New code* - never by the page's
  own auto-refresh. Each PC gets its own random token (the server stores only a SHA-256 hash; the app stores it
  DPAPI-encrypted for the user). PCs can be removed on the setup page.
* **Setup page** (`/setup`) answers only on the server itself, and only when the browser asked for `localhost`,
  `127.0.0.1` or `[::1]` (so a web page can't reach it by pointing its own name at 127.0.0.1). Anyone signed in to the
  server can use it. It is rendered on the server, so it works in any browser including Internet Explorer and with
  scripts disabled; every change carries a per-start secret token, so other web pages can't trigger them. With no
  browser at all (Server Core), double-clicking the exe prints the same details (TV address, server name, pairing code)
  in its console window.
* All changes are validated (types, lengths, IDs), requests are limited to 2 MB, every change is applied at most once,
  and every page is served with a strict Content-Security-Policy.
* Optional app PIN locks the app's Settings and Edit mode (checked in the app's privileged process).

## Hardening built in

* **App:** Electron 45 (supported, receives security fixes). Window sandboxed with context isolation and no Node.js;
  only the app's own files can load; no navigation, pop-ups or embedded pages; all permission requests (camera,
  notifications…) refused; spell-check (which would download dictionaries) off. Electron fuses: `RunAsNode` off,
  `NODE_OPTIONS` and `--inspect` ignored, app code only from `app.asar`, `app.asar` integrity checked at start-up.
  Demo mode and test hooks don't exist in the installed app.
* **Server:** `NODE_OPTIONS` / `--node-options` ignored by the .exe. Program in Program Files; data folder owned by
  Administrators with inheritance removed. The install's temporary task file is written in the protected program
  folder, not in `%TEMP%`. The Program Files path is read from the registry, not from environment variables.
* Both executables import only standard Windows DLLs (no Visual C++ Redistributable, .NET or other runtime).

## Data

`C:\ProgramData\inventrustock-server\`: `data.json` (stock), `server.json` (name, port, paired PCs), `log.csv` (every
change: time, item, change, new quantity, Windows user@PC; archived as `log-<date>.csv` at 10 MB), `backups\` (daily,
30 kept), `server.log` (1 MB, then `server.log.old`). A VM checkpoint/backup also backs this up.

Writes are atomic (temp file + fsync + rename, previous version kept as `.bak`). A file held open by other software
(antivirus, backup) is retried for a few seconds; if it still can't be read, the server doesn't start (the watchdog
retries) rather than starting with an empty list. A change that can't be saved is rolled back and answered with 503,
so the PC keeps it and sends it again. Excluding `C:\ProgramData\inventrustock-server` from real-time scanning is fine
but not required.

The app keeps, per Windows user, in `%APPDATA%\inventrustock-app\`: `config.json` (settings, DPAPI-encrypted pairing
token), `cache.json` (a copy of the list, so it opens offline), `queue.json` (changes not yet sent), `app.log`, plus
Chromium's own cache folders. With *Just this PC*, also `stock\`: the same `data.json`, `log.csv` and `backups\` as on
the server, written by the same code with the same safeguards (a change that can't be saved stays queued and is
retried; the status shows *Not saved*). That list exists only on that PC and user profile, so include
`%APPDATA%\inventrustock-app\stock\` in backups (roaming profiles / folder redirection carry it along).

## Deployment

* **Server:** `InventruServer.exe --install [--port N]` does the same as double-clicking, without the browser (it asks
  for elevation by itself if needed; from an elevated prompt it doesn't). `--dry-run` prints every command and the task
  XML first. Also `--uninstall`, `--status`, `--version`, `--export FILE`, `--import FILE` (the last two with the
  server stopped).
* **App:** `Inventru-Setup-1.0.0.exe /S` installs silently for the current user (it doesn't start the app). Pairing is
  done once per user in the app. Silent uninstall:
  `"%LOCALAPPDATA%\Programs\inventrustock-app\Uninstall Inventru.exe" /S`.
* Neither is code-signed: SmartScreen shows "unknown publisher"; AppLocker/WDAC may need a hash or path rule, or sign
  both with your certificate (`signtool`) before deploying. The app is per-user, so it lives under the user profile:
  allow `%LOCALAPPDATA%\Programs\inventrustock-app\` if executables there are blocked.

## Requirements and dependencies

* **Server:** Windows 10/11 or Windows Server 2016+ (Desktop Experience or Core), x64. Nothing to install first.
  Install uses only built-in tools: PowerShell (permission prompt), `schtasks`, `netsh`, `icacls`, `whoami`, `reg`.
* **App:** Windows 10/11 x64. Nothing to install first.
* **TV:** any web browser from roughly 2017 onwards (Chromium/Edge 61+, Safari 11+, Firefox 60+, most smart-TV
  browsers). Internet Explorer can show the server's setup page but not the dashboard.

## Updates

Electron and Node.js publish security fixes regularly; rebuild with current versions (`npm run dist`, see ABOUT.md)
for new releases. Updating keeps all data: double-click the new `InventruServer.exe` on the server, run the new
installer on each PC.

## Third-party

Electron 45.2.3 (Chromium 156, Node.js 24.22) inside the app; Node.js 26.13 inside the server executable. No other
runtime libraries. Their licences are included (`LICENSE.electron.txt`, `LICENSES.chromium.html` in the app folder).
