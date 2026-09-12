#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');

(async () => {
  for (const [name, action] of [['order', 'list'], ['pay', 'request'], ['withdrawal', 'info']]) {
    let reads = 0;
    const db = { command: {}, collection: () => {
      reads++;
      throw new Error('unauthenticated database access');
    } };
    const cloud = { init() {}, database: () => db, getWXContext: () => ({}) };
    const filename = path.join(root, 'cloudfunctions', name, 'index.js');
    const module = { exports: {} };
    const realRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, require: id => id === 'wx-server-sdk' ? cloud : realRequire(id),
      console: { log() {}, warn() {}, error() {} }, process, Buffer
    }, { filename });
    const result = await module.exports.main({ action, OPENID: 'forged-victim', orderId: 'victim-order' }).catch(() => null);
    assert.equal(reads, 0, name + ': untrusted OPENID must not reach database');
    assert(result && result.success === false, name + ': reject missing trusted identity');
    console.log('PASS trusted identity:', name);
  }
})().catch(err => { console.error(err.message); process.exitCode = 1; });
