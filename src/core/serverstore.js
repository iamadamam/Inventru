'use strict';
const { SyncError } = require('./errors');

const DEFAULT_PORT = 8080;

/** "stock-vm" -> "http://stock-vm:8080";  "10.0.0.5:8090/x" -> "http://10.0.0.5:8090". Throws on anything else. */
function serverOrigin(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the server name, e.g. STOCK-VM');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) throw new Error('Enter a server name like STOCK-VM or STOCK-VM:8080');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  if (u.username || u.password || !u.hostname) throw new Error('Enter a server name like STOCK-VM or STOCK-VM:8080');
  if (!u.port && u.protocol === 'http:' && !/:\d+(\/|$)/.test(s.replace(/^https?:\/\//i, ''))) u.port = String(DEFAULT_PORT);
  return u.origin;
}

/** Turn a network/HTTP failure into a clear message. */
async function failure(res, origin, write) {
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) return new SyncError(j.error || 'This PC is not paired with the server. Pair it again in Settings.', { kind: 'auth', status: 401 });
  if (res.status === 403) return new SyncError(j.error || 'Not allowed.', { kind: 'auth', status: 403 });
  if (res.status === 404) return new SyncError(`${origin.replace(/^https?:\/\//, '')} is not an Inventru server.`, { kind: 'config', status: 404 });
  if (res.status >= 500) return new SyncError(`Server error (${res.status})`, { kind: 'server', status: res.status, ambiguous: write });
  return new SyncError(j.error || `The server refused the request (${res.status})`, { kind: 'config', status: res.status });
}

/**
 * The Inventru server (e.g. on a VM). The interface the sync engine uses for a store:
 * fetchItems(), applyBatch(ops), wasApplied(opIds). The server remembers every op ID it has applied,
 * so a resend after a lost response is never applied twice.
 */
class ServerStore {
  constructor({ url, token, fetchFn = (...a) => fetch(...a), user = '', timeoutMs = 10000 }) {
    this.origin = serverOrigin(url);
    this.token = token || '';
    this.fetchFn = fetchFn;
    this.user = user;
    this.timeoutMs = timeoutMs;
    this._etag = null;
    this._items = null;
    this.name = null;
  }

  async _req(method, path, body, { write = false, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST' && auth) { headers.Authorization = `Bearer ${this.token}`; if (this.user) headers['X-Inventru-User'] = this.user; }
    if (method === 'GET' && path === '/api/items' && this._etag) headers['If-None-Match'] = this._etag;
    let res;
    try {
      res = await this.fetchFn(`${this.origin}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new SyncError(`Cannot reach the server ${this.origin.replace(/^https?:\/\//, '')} (${e.message || 'network error'})`, { kind: 'network', ambiguous: write });
    }
    if (res.status === 304) return { notModified: true, res };
    if (!res.ok) throw await failure(res, this.origin, write);
    return { json: await res.json().catch(() => ({})), res };
  }

  async fetchItems() {
    const r = await this._req('GET', '/api/items');
    if (r.notModified && this._items) return this._items.map((i) => ({ ...i }));
    this._etag = r.res.headers.get('etag');
    this.name = r.json.name || this.name;
    this._items = (r.json.items || []).map((i) => ({
      id: String(i.id), name: String(i.name), qty: Math.max(0, Number(i.qty) || 0), ordered: !!i.ordered,
      group: i.group || '', sub: i.sub || '', low: i.low ?? null,
    }));
    return this._items.map((i) => ({ ...i }));
  }

  async applyBatch(ops) {
    const r = await this._req('POST', '/api/batch', { ops }, { write: true });
    this._etag = null;
    return { results: (r.json.results || []).map((x) => (x.status === 'invalid' ? { ...x, status: 'missing' } : x)), error: null };
  }

  async wasApplied(opIds) {
    const r = await this._req('POST', '/api/applied', { opIds });
    return new Set(r.json.applied || []);
  }

  async importCsv(csv) {
    const r = await this._req('POST', '/api/import', { csv }, { write: true });
    this._etag = null;
    return r.json;
  }

  /** Is there an Inventru server at this address? -> { name, version, items } */
  async info() {
    const h = await this._req('GET', '/api/health');
    if (!h.json || h.json.app !== 'inventru-server') throw new SyncError(`${this.origin.replace(/^https?:\/\//, '')} is not an Inventru server.`, { kind: 'config' });
    return h.json;
  }

  /** Pair this PC with the 6-digit code from the server's setup page. Returns the device token. */
  async pair(code, deviceName) {
    await this.info();
    const r = await this._req('POST', '/api/pair', { code: String(code || '').replace(/\D/g, ''), device: deviceName }, { auth: false });
    this.token = r.json.token;
    this.name = r.json.name;
    return { token: r.json.token, name: r.json.name };
  }

  async check() { await this._req('POST', '/api/check', {}); return true; }
}

module.exports = { ServerStore, serverOrigin };
