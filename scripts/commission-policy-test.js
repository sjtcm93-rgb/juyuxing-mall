#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

(async () => {
  for (const name of ['order', 'pay']) {
    const source = fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8');
    const match = source.match(/async function getCommissionRate\([^]*?\n\}/);
    assert(match, 'commission function exists: ' + name);
    let values = {};
    const db = { collection: key => ({ doc: () => ({ get: async () => ({ data: values[key] || {} }) }) }) };
    const getRate = vm.runInNewContext(match[0] + '\ngetCommissionRate;', { db });
    assert.equal(await getRate(), 0.33, 'new default is 33%');
    values = { admin_config: { commissionRate: 0.15 } };
    assert.equal(await getRate(), 0.15, 'explicit admin setting is honored');
    values.pay_config = { commissionRate: 0.2 };
    assert.equal(await getRate(), 0.2, 'legacy payment setting precedence is explicit');
    values.pay_config.commissionRate = 0;
    assert.equal(await getRate(), 0, 'zero commission is valid');
    console.log('PASS commission policy:', name);
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
