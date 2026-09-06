#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function referralCode(userId, used) {
  let offset = 0;
  while (offset < 100) {
    const code = 'JY' + crypto.createHash('sha256').update(`${userId}:${offset}`).digest('hex').slice(0, 8).toUpperCase();
    if (!used.has(code)) { used.add(code); return code; }
    offset++;
  }
  throw new Error('无法生成唯一推广码: ' + userId);
}

function passwordHash(password) {
  const salt = crypto.createHash('sha256').update('juyuxing-owner-migration').digest('hex').slice(0, 32);
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function migrateSnapshot(snapshot) {
  const data = JSON.parse(JSON.stringify(snapshot || {}));
  const users = data.users || (data.users = []);
  const used = new Set(users.map(user => user.referralCode).filter(Boolean));
  users.forEach(user => {
    if (user.isAgent && !user.referralCode) user.referralCode = referralCode(user._id, used);
  });
  (data.products || (data.products = [])).forEach(product => {
    product.reservedStock = Number(product.reservedStock) || 0;
    product.specs = (product.specs || []).map(spec => ({ ...spec, reservedStock: Number(spec.reservedStock) || 0 }));
  });
  (data.orders || (data.orders = [])).forEach(order => {
    if (order.status === 'cancelled' || (order.status === 'pending' && !order.expireTime)) {
      order.status = 'closed';
      order.closeReason = 'abc_v1_migration';
      order.inventoryStatus = order.inventoryStatus || 'released';
    }
  });
  (data.commissions || (data.commissions = [])).forEach(commission => {
    commission.type = commission.type || 'earning';
    commission.idempotencyKey = commission.idempotencyKey || `commission:${commission.orderId}:${commission._id}`;
    if (commission.status === 'pending') commission.status = 'frozen';
    if (commission.status === 'refunded') commission.status = 'cancelled';
  });
  (data.withdrawals || (data.withdrawals = [])).forEach(withdrawal => {
    withdrawal.requestId = withdrawal.requestId || `legacy_${withdrawal._id}`;
    withdrawal.idempotencyKey = withdrawal.idempotencyKey || `legacy_withdrawal:${withdrawal._id}`;
  });
  (data.refunds || (data.refunds = [])).forEach(refund => {
    refund.idempotencyKey = refund.idempotencyKey || `legacy_refund:${refund._id}`;
  });
  const adminConfig = (data.admin_config || []).find(item => item._id === 'admin');
  data.admin_accounts = data.admin_accounts || [];
  if (!data.admin_accounts.some(account => account.username === 'owner') && adminConfig && adminConfig.password) {
    data.admin_accounts.push({
      _id: 'owner', username: 'owner', displayName: '店主', role: 'owner', status: 'active',
      passwordHash: passwordHash(adminConfig.password), migratedFromLegacy: true
    });
  }
  data.admin_sessions = data.admin_sessions || [];
  data.agent_invites = data.agent_invites || [];
  data.inventory_reservations = data.inventory_reservations || [];
  data.inventory_adjustments = data.inventory_adjustments || [];
  data.cashflow_entries = data.cashflow_entries || [];
  return data;
}

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('用法: node scripts/migrate-abc.js <数据库快照.json> <迁移后快照.json>');
    process.exit(1);
  }
  const source = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  fs.writeFileSync(path.resolve(output), JSON.stringify(migrateSnapshot(source), null, 2) + '\n');
  console.log('ABC v1 快照迁移完成:', path.resolve(output));
}

module.exports = { migrateSnapshot };
