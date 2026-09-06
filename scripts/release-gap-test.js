#!/usr/bin/env node
'use strict';

// Execute deployed entry points with an isolated in-memory SDK; never connects to CloudBase.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function fixture() {
  const rows = {};
  const state = { openId: 'test-stranger', generated: [], uploaded: [] };
  const table = name => rows[name] || (rows[name] = []);
  const query = (name, filter = {}, max = Infinity) => ({
    where: value => query(name, value, max),
    limit: value => query(name, filter, value),
    get: async () => ({ data: table(name).filter(row => Object.keys(filter).every(key => row[key] === filter[key])).slice(0, max).map(row => ({ ...row })) }),
    count: async () => ({ total: (await query(name, filter).get()).data.length }),
    add: async ({ data }) => {
      const _id = 'test-' + table(name).length;
      table(name).push({ _id, ...data });
      return { _id };
    },
    doc: id => ({
      get: async () => ({ data: table(name).find(row => row._id === id) }),
      set: async ({ data }) => {
        const index = table(name).findIndex(row => row._id === id);
        if (index >= 0) table(name)[index] = { _id: id, ...data };
        else table(name).push({ _id: id, ...data });
      },
      update: async ({ data }) => {
        const row = table(name).find(value => value._id === id);
        assert(row, 'update target exists');
        Object.assign(row, data);
        return { stats: { updated: 1 } };
      }
    })
  });
  const sdk = {
    init: () => {}, database: () => ({ collection: query, serverDate: () => new Date() }),
    getWXContext: () => ({ OPENID: state.openId }),
    openapi: { wxacode: { getUnlimited: async options => {
      state.generated.push(options);
      return { buffer: Buffer.from('test-image') };
    } } },
    uploadFile: async options => {
      state.uploaded.push(options.cloudPath);
      return { fileID: 'cloud://test/' + options.cloudPath };
    }
  };
  return { rows, state, sdk };
}

function loadFunction(name, sdk, env = {}) {
  const filename = path.resolve(__dirname, '../cloudfunctions', name, 'index.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, console,
    process: { env }, require: id => id === 'wx-server-sdk' ? sdk : localRequire(id)
  }, { filename });
  return module.exports.main;
}

async function testPromotion() {
  const f = fixture();
  f.rows.admin_accounts = [{ _id: 'owner', wechatOpenId: f.state.openId, status: 'active', role: 'owner' }];
  const trial = loadFunction('promotion', f.sdk, { MINIPROGRAM_ENV_VERSION: 'trial' });
  assert.equal((await trial({ action: 'asset' })).success, false, 'admin account alone cannot impersonate an agent');
  assert.equal(f.state.generated.length, 0);
  f.rows.users = [{ _id: f.state.openId, isAgent: true, agentInfo: { status: 'active' }, referralCode: 'JYABCDEFGH' }];
  f.rows.products = [{ _id: 'product', status: 'on' }];
  const home = await trial({ action: 'asset' });
  assert.equal(home.success, true);
  assert.equal((await trial({ action: 'asset' })).data.qrFileId, home.data.qrFileId);
  assert.equal(f.state.generated.length, 1, 'same environment reuses QR');
  const release = loadFunction('promotion', f.sdk, { MINIPROGRAM_ENV_VERSION: 'release' });
  const published = await release({ action: 'asset' });
  assert.notEqual(published.data.qrFileId, home.data.qrFileId, 'release cannot reuse trial image or cloud path');
  assert.equal(f.state.generated[1].envVersion, 'release');
  delete f.rows.promotion_targets[0].qrEnvVersion;
  await release({ action: 'asset' });
  assert.equal(f.state.generated.length, 3, 'legacy cache without environment metadata regenerates');
  const product = await release({ action: 'asset', productId: 'product' });
  assert.equal(product.data.type, 'product');
  assert(product.data.sharePath.includes('id=product&ref=JYABCDEFGH'));
  f.rows.users[0].agentInfo.status = 'disabled';
  assert.equal((await release({ action: 'asset' })).success, false, 'disabled agent loses access even if admin');
}

async function testNoFirstScanOwner() {
  for (const env of [{}, { ALLOW_ADMIN_BOOTSTRAP: 'true' }]) {
    const f = fixture();
    f.rows.admin_login_tickets = [{ _id: 'ticket', publicId: 'abcdefghijklmnop', status: 'pending', expiresAt: new Date(Date.now() + 60000) }];
    const main = loadFunction('adminQrAuth', f.sdk, env);
    const event = { action: 'inspectQrLogin', publicId: 'abcdefghijklmnop' };
    assert.equal((await main(event)).success, false, 'first stranger must never become owner');
    assert.equal((await main({ ...event, action: 'confirmQrLogin' })).success, false, 'confirmation also cannot bootstrap owner');
    assert.equal(f.rows.admin_accounts.length, 0, 'inspection does not create an admin');
    f.rows.admin_accounts.push({ _id: 'owner', wechatOpenId: f.state.openId, status: 'active', role: 'owner', username: 'owner' });
    assert.equal((await main(event)).success, true, 'existing binding still works');
    f.rows.admin_config = [{ _id: 'admin', adminOpenIds: [f.state.openId, 'test-other-legacy'] }];
    f.state.openId = 'test-other-legacy';
    assert.equal((await main(event)).success, false, 'legacy identity cannot reuse an owner bound to another WeChat');
  }
}

(async () => {
  const failures = [];
  for (const test of [testPromotion, testNoFirstScanOwner]) {
    try { await test(); console.log('PASS ' + test.name); }
    catch (err) { failures.push(err); console.error('FAIL ' + test.name + ': ' + err.message); }
  }
  if (failures.length) process.exitCode = 1;
})();
