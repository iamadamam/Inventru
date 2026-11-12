'use strict';
const fs = require('fs');
const path = require('path');
const { SyncError } = require('./errors');
const { openStockBook } = require('./stockbook');

/**
 * "Just this PC": the stock list is kept in a folder on this PC instead of on a server.
 * Same interface as ServerStore (fetchItems, applyBatch, wasApplied, importCsv), and the same code the server uses to
 * save the list (src/core/stockbook.js): a change is applied once, saved safely, logged in log.csv, backed up daily.
 * The folder is opened on first use, so a file held by another program is retried later, not treated as an empty list.
 */
class LocalStore {
  constructor({ dir, user = '', log = () => {} }) {
    this.dir = dir;
    this.user = user;
    this.log = log;
    this.book = null;
    this.name = null;
  }

  _open() {
    if (this.book) return this.book;
    try {
      this.book = openStockBook({ dir: this.dir, log: this.log, saveError: 'The change could not be saved on this PC - it will be tried again.' });
    } catch (e) {
      throw new SyncError(`Cannot open the stock list in ${this.dir} (${e.code || e.message})`, { kind: 'disk' });
    }
    return this.book;
  }

  async fetchItems() { return this._open().items(); }

  async applyBatch(ops) {
    const book = this._open();
    try {
      return { results: book.applyOps(ops, this.user).results.map((x) => (x.status === 'invalid' ? { ...x, status: 'missing' } : x)) };
    } catch (e) {
      throw new SyncError(e.message, { kind: 'disk' }); // nothing was kept (the list is rolled back): try again later
    }
  }

  async wasApplied(opIds) { return new Set(this._open().wasApplied(opIds)); }

  async importCsv(csv) {
    try { return this._open().importCsv(csv, this.user); } catch (e) { throw new SyncError(e.message, { kind: 'disk' }); }
  }

  /** How many items the list on this PC has (0 if there is none yet - the folder isn't created just to look). */
  count() {
    if (!this.book && !fs.existsSync(path.join(this.dir, 'data.json'))) return 0;
    try { return this._open().state.rows.length; } catch { return 0; }
  }
}

module.exports = { LocalStore };
