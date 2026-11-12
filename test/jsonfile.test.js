'use strict';
// Saving and reading the JSON files (server stock list, app settings, offline queue) safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('../src/core/jsonfile');
const { createServer } = require('../server/server');
const { tmpDir } = require('./helpers');

test('each save keeps the previous version as .bak', () => {
  const f = path.join(tmpDir(), 'data.json');
  writeJsonAtomic(f, { v: 1 });
  writeJsonAtomic(f, { v: 2 });
  assert.deepEqual(readJson(f, null), { v: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8')), { v: 1 });
  assert.ok(!fs.existsSync(`${f}.tmp`), 'no temp file left');
});

test('a damaged file is kept aside and the previous version is used', () => {
  const f = path.join(tmpDir(), 'data.json');
  writeJsonAtomic(f, { v: 1 });
  writeJsonAtomic(f, { v: 2 });
  fs.writeFileSync(f, '{ half written');
  assert.deepEqual(readJson(f, null), { v: 1 });
  assert.equal(fs.readdirSync(path.dirname(f)).filter((x) => x.startsWith('data.json.corrupt-')).length, 1);
});

test('a missing file falls back to its .bak copy, then to the default', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'data.json');
  assert.equal(readJson(f, 'default'), 'default');
  fs.writeFileSync(`${f}.bak`, '{"v":1}');
  assert.deepEqual(readJson(f, 'default'), { v: 1 });
});

test('a file that cannot be opened is an error - never quietly treated as empty', () => {
  const f = path.join(tmpDir(), 'data.json');
  fs.mkdirSync(f); // something in the way that isn't a readable file
  assert.throws(() => readJson(f, {}, { retries: 0 }));
});

test('the server will not start with an empty list when its stock file cannot be read', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'data.json'));
  assert.throws(() => createServer({ dataDir: dir, port: 0, host: '127.0.0.1', getAsset: () => null }));
});
