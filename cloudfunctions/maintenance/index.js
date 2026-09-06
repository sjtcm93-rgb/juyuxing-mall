'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

function withTransaction(work) {
  return typeof db.runTransaction === 'function' ? db.runTransaction(work) : work(db);
}

function releaseProduct(product, specName, quantity) {
  const specs = Array.isArray(product.specs) ? product.specs.map(spec => ({ ...spec })) : [];
  const index = specs.findIndex(spec => spec.name === specName);
  if (index >= 0) specs[index].reservedStock = Math.max(0, (Number(specs[index].reservedStock) || 0) - quantity);
  return { specs, reservedStock: Math.max(0, (Number(product.reservedStock) || 0) - quantity) };
}

async function closeExpired(order) {
  return withTransaction(async transaction => {
    const currentRes = await transaction.collection('orders').doc(order._id).get().catch(() => null);
    const current = currentRes && currentRes.data;
    if (!current || current.status !== 'pending' || current.inventoryStatus !== 'reserved') return false;
    const reservations = await transaction.collection('inventory_reservations')
      .where({ orderId: current._id, status: 'reserved' }).get();
    for (const reservation of reservations.data || []) {
      const productRes = await transaction.collection('products').doc(reservation.productId).get().catch(() => null);
      if (productRes && productRes.data) {
        const next = releaseProduct(productRes.data, reservation.spec, Number(reservation.quantity) || 0);
        await transaction.collection('products').doc(reservation.productId).update({
          data: { ...next, updateTime: db.serverDate() }
        });
      }
      await transaction.collection('inventory_reservations').doc(reservation._id).update({
        data: { status: 'released', releaseReason: 'payment_timeout', releaseTime: db.serverDate() }
      });
    }
    await transaction.collection('orders').doc(current._id).update({ data: {
      status: 'closed', inventoryStatus: 'released', closeReason: 'payment_timeout',
      closeTime: db.serverDate(), updateTime: db.serverDate()
    } });
    return true;
  });
}

async function autoReceive(order) {
  return withTransaction(async transaction => {
    const currentRes = await transaction.collection('orders').doc(order._id).get().catch(() => null);
    const current = currentRes && currentRes.data;
    if (!current || current.status !== 'shipped') return false;
    if (current.agentId) {
      await transaction.collection('commissions').where({ orderId: current._id, status: 'frozen' }).update({
        data: { status: 'settled', settleTime: db.serverDate(), settleSource: 'auto_receive' }
      });
    }
    await transaction.collection('orders').doc(current._id).update({ data: {
      status: 'received', receivedTime: db.serverDate(), autoReceived: true,
      commissionStatus: current.agentId ? 'settled' : 'none', updateTime: db.serverDate()
    } });
    return true;
  });
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (OPENID) return { success: false, error: '该函数只允许定时触发器调用' };
  const now = new Date();
  const receiveBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const expired = await db.collection('orders')
    .where({ status: 'pending', expireTime: _.lte(now) }).limit(100).get().catch(() => ({ data: [] }));
  const shipped = await db.collection('orders')
    .where({ status: 'shipped', shipTime: _.lte(receiveBefore) }).limit(100).get().catch(() => ({ data: [] }));
  let closed = 0;
  let received = 0;
  for (const order of expired.data || []) if (await closeExpired(order)) closed++;
  for (const order of shipped.data || []) if (await autoReceive(order)) received++;
  return { success: true, closed, received };
};
