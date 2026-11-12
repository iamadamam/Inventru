# Changelog

## 1.0.0 - 10 November 2026

First release of **Inventru**: keep count of the store room's stock from one PC, keep the list on your own server, and
show it live on a TV - or use the app on its own, with no server at all.

**Store-room app**
- Keyboard-first stock list: + / −, type an exact amount, Ordered, search, category and subcategory filters.
- Edit mode: add, rename, categories and subcategories, icons (built-in or your own), "per click" step, warn levels,
  drag and drop, hide, delete, clear all Ordered / set all to 0 with undo, CSV import and export.
- Works through network drops: changes wait on the PC and are sent once the server is back - never lost, never counted
  twice.
- **Just this PC**: no server needed - the list, its change log and daily backups are kept on the PC. Connect to a
  server later in Settings (an empty server gets a copy of the list), or switch a PC from a server to Just this PC.
- Optional PIN for Settings and Edit mode; locks again after 5 minutes without use.
- Starts with Windows (can be turned off); keeps the screen awake (can be turned off); dark, light or follow Windows.

**Server**
- One file, double-click to install: starts with Windows, restarts itself if it stops.
- Setup page with the TV address, server name and a 6-digit pairing code (works in any browser, even without scripts).
- Pair PCs with a one-time code; remove them at any time.
- Change log (who changed what, opens in Excel), daily backups kept for 30 days, CSV backup download and import.

**TV dashboard**
- Needs attention (out and low), stock by category with subcategory bars, and what's on order - updated within a second.
- Works in any browser from about 2017 onwards.

**Safe to run in a company network**
- Nothing to install first; no internet, cloud or accounts needed; no outbound connections.
- Only paired PCs can change stock; the setup page only opens on the server itself.
- The app's window is locked down, its pairing token is encrypted with Windows (DPAPI), and the program checks its own
  files at start-up.
- Folders are named `inventrustock-app` / `inventrustock-server`; everything the installer changes is listed in
  ABOUT.md, and uninstalling removes it (your data is kept until you delete it).
