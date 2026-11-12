'use strict';
// Test helper: a plain browser window (Electron's Chromium, normal web-page rules) that opens INVENTRU_URL.
// Used by e2e-browser.js to check the server's setup page and TV dashboard in a real browser.
const path = require('path');
const { app, BrowserWindow } = require('electron');

const dir = app.commandLine.getSwitchValue('user-data-dir');
if (dir) app.setPath('userData', path.resolve(dir));
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  win.loadURL(process.env.INVENTRU_URL);
});
app.on('window-all-closed', () => app.quit());
