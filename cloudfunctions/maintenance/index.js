'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;
const confirmPayment = require('./payment-effects').createPaymentEffects(cloud, db);

// 支付回调丢失自愈：下单超过该分钟数仍 pending 且已产生预支付单的订单，
// 主动向微信查单；查到已支付则补齐支付副作用（订单置 paid、扣库存、记现金流、生成佣金）。
const RECONCILE_AFTER_MINUTES = 3;
const RECONCILE_BATCH_LIMIT = 20;

function withTransaction(work) {
  return typeof db.runTransaction === 'function' ? db.runTransaction(work) : work(db);
}

function generateNonceStr(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let str = '';
  for (let i = 0; i < length; i++) str += chars.charAt(Math.floor(Math.random() * chars.length));
  return str;
}

async function getSubMchId() {
  const cfgRes = await db.collection('pay_config').doc('default').get().catch(() => null);
  const config = (cfgRes && cfgRes.data) || {};
  return String(config.subMchId || '').trim();
}

function releaseProduct(product, specName, quantity) {
  const specs = Array.isArray(product.specs) ? product.specs.map(spec => ({ ...spec })) : [];
  const index = specs.findIndex(spec => spec.name === specName);
  if (index >= 0) specs[index].reservedStock = Math.max(0, (Number(specs[index].reservedStock) || 0) - quantity);
  return { specs, reservedStock: Math.max(0, (Number(product.reservedStock) || 0) - quantity) };
}

// 查单对账：微信侧已支付但回调未落库的订单，补齐支付副作用。
// 必须在 closeExpired 之前执行，避免把"用户已付款、回调丢失"的订单误关。
async function reconcilePayments(subMchId) {
  const result = { checked: 0, reconciled: 0, failed: 0 };
  if (!subMchId || !cloud.cloudPay || typeof cloud.cloudPay.queryOrder !== 'function') return result;
  const since = new Date(Date.now() - RECONCILE_AFTER_MINUTES * 60 * 1000);
  const res = await db.collection('orders')
    .where({ status: 'pending', createTime: _.lt(since) })
    .limit(100).get().catch(() => ({ data: [] }));
  const candidates = (res.data || [])
    .filter(order => order.prepayId && Number(order.totalFee) > 0)
    .slice(0, RECONCILE_BATCH_LIMIT);
  for (const order of candidates) {
    result.checked++;
    try {
      const query = await cloud.cloudPay.queryOrder({
        subMchId,
        outTradeNo: order.orderNo,
        nonceStr: generateNonceStr()
      });
      const tradeState = query && (query.tradeState || query.trade_state);
      if (tradeState !== 'SUCCESS') continue;
      const totalFeeValue = query && (query.totalFee !== undefined ? query.totalFee : query.total_fee);
      await confirmPayment({
        outTradeNo: order.orderNo,
        transactionId: (query && (query.transactionId || query.transaction_id)) || '',
        totalFee: totalFeeValue === undefined ? null : Number(totalFeeValue),
        source: 'reconcile'
      });
      result.reconciled++;
      console.log('[maintenance] 对账补齐已支付订单:', order.orderNo);
    } catch (err) {
      result.failed++;
      console.error('[maintenance] 对账失败:', order.orderNo, err && (err.message || err));
    }
  }
  return result;
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

  // 第一步：查单对账（先于关单，防止误关已支付订单）
  const subMchId = await getSubMchId();
  const reconcile = await reconcilePayments(subMchId);

  // 第二步：关闭超时未支付订单（对账后仍 pending 的才会走到这里）
  const expired = await db.collection('orders')
    .where({ status: 'pending', expireTime: _.lte(now) }).limit(100).get().catch(() => ({ data: [] }));

  const shipped = await db.collection('orders')
    .where({ status: 'shipped', shipTime: _.lte(receiveBefore) }).limit(100).get().catch(() => ({ data: [] }));
  let closed = 0;
  let received = 0;
  for (const order of expired.data || []) if (await closeExpired(order)) closed++;
  for (const order of shipped.data || []) if (await autoReceive(order)) received++;
  return { success: true, closed, received, reconcile };
};
