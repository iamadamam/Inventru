'use strict';
/*
 * Test helper: starts a program built on Chromium (the Inventru app, or Electron as a plain browser) and drives its
 * window through the Chrome DevTools Protocol (the standard --remote-debugging-port switch). The app itself needs no
 * test hooks. Used by e2e.js, e2e-server.js, e2e-browser.js and test-release.js.
 */
const { spawn } = require('child_process');
const net = require('net');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/**
 * launch(exe, args, { env, match, ready }) -> { evaluate(js), waitFor(js, ms), call(method, params), on(fn), close(), exited }
 *   match(target)  which page to drive (default: the first page)
 *   ready          JavaScript that is true once the page is usable
 */
async function launch(exe, args, { env = process.env, match = (t) => t.type === 'page', ready = 'document.readyState === "complete"', timeoutMs = 30000 } = {}) {
  const port = await freePort();
  const proc = spawn(exe, [...args, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const state = { exited: null };
  proc.on('exit', (code) => { state.exited = code; });

  let target = null;
  for (const t0 = Date.now(); !target; await sleep(250)) {
    if (state.exited !== null) throw new Error(`the program closed (code ${state.exited}) before its window opened`);
    if (Date.now() - t0 > timeoutMs) { proc.kill(); throw new Error('no window opened'); }
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(match) || null; } catch { /* not listening yet */ }
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not connect to the window')); });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) for (const fn of listeners) fn(msg.method, msg.params);
  };
  ws.onclose = () => { for (const r of pending.values()) r({ error: { message: 'window closed' } }); pending.clear(); };
  const call = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

  async function evaluate(expression) {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.error) throw new Error(r.error.message);
    const ex = r.result.exceptionDetails;
    if (ex) throw new Error((ex.exception && ex.exception.description) || ex.text);
    return r.result.result.value;
  }
  /** Poll a JavaScript expression until it is truthy (navigation in between is fine). */
  async function waitFor(expression, ms = 10000) {
    for (const t0 = Date.now(); ; await sleep(150)) {
      const v = await evaluate(expression).catch(() => false);
      if (v) return v;
      if (Date.now() - t0 > ms) return v;
    }
  }
  async function close() {
    evaluate('window.close()').catch(() => {});
    for (let i = 0; i < 50 && state.exited === null; i++) await sleep(200);
    if (state.exited === null) proc.kill();
    try { ws.close(); } catch { /* ignore */ }
  }

  if (!(await waitFor(ready, timeoutMs))) { proc.kill(); throw new Error('the page did not finish loading'); }
  /** on((method, params) => ...): DevTools events, e.g. Log.entryAdded after call('Log.enable'). */
  const on = (fn) => listeners.push(fn);
  return { evaluate, waitFor, close, call, on, get exited() { return state.exited; } };
}

module.exports = { launch, freePort, sleep };
