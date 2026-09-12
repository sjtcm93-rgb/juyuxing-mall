#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

(async () => {
  let page;
  let calls = 0;
  let consent = false;
  let response = { success: true, processed: 1, completed: 0, waiting: 1, manualReview: 0 };
  const wx = {
    showModal: options => options.success({ confirm: consent }),
    cloud: { callFunction: async request => {
      calls++; assert.equal(request.name, 'refund-processor');
      assert.equal(request.data.action, 'sweep');
      if (response instanceof Error) throw response;
      return { result: response };
    } }
  };
  const filename = path.join(root, 'miniprogram/subpackages/admin-auth/confirm/confirm.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: value => { page = value; }, wx, require: () => ({}) });
  page.setData = value => Object.assign(page.data, value);
  for (const role of ['operations', 'consumer']) {
    page.data.account = { role }; consent = true;
    await page.processRefundQueue(); assert.equal(calls, 0);
  }
  page.data.account = { role: 'finance' }; consent = false;
  await page.processRefundQueue(); assert.equal(calls, 0, 'cancel never submits');
  consent = true; await page.processRefundQueue();
  assert.equal(calls, 1);
  assert(page.data.refundResult.includes('成功入账 0'));
  assert(page.data.refundResult.includes('渠道处理中 1'));
  response = new Error('test timeout'); await page.processRefundQueue();
  assert(page.data.refundResult.includes('不要重复退款'));
  assert.equal(page.data.processingRefunds, false);
  assert(!fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8').includes("name: 'refund-processor'"), 'consumer launch never executes refunds');
  console.log('PASS refund operator UI (mocked only)');
})().catch(err => { console.error(err); process.exitCode = 1; });
