'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;
const confirmPayment = require('./payment-effects').createPaymentEffects(cloud, db);

const ORDER_EXPIRE_MS = 30 * 60 * 1000;
// 回调丢失自愈：下单超过该时间仍 pending 且有预支付单的订单，主动查单补齐支付副作用
const RECONCILE_AFTER_MS = 3 * 60 * 1000;

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

// 用户侧对账自愈（必须带微信用户上下文调用：cloudPay 云调用类接口在定时器/服务端直调下无有效票据）。
// 1) 微信侧已支付但回调未落库的订单 → 补齐支付副作用（置 paid、扣库存、记现金流、生成佣金）；
// 2) 已过期且微信侧未支付的订单 → 释放库存并关闭（maintenance 定时器在无上下文调用下事务不可用）。
// 任何失败都不阻塞主流程，只记日志。
async function reconcilePendingOrders(userId) {
  try {
    if (!userId) return;
    const since = new Date(Date.now() - RECONCILE_AFTER_MS);
    const res = await db.collection('orders')
      .where({ userId, status: 'pending', createTime: _.lt(since) })
      .limit(10).get().catch(() => ({ data: [] }));
    const orders = res.data || [];
    if (!orders.length) return;
    const now = Date.now();
    const subMchId = await getSubMchId();
    for (const order of orders) {
      try {
        const expired = order.expireTime && new Date(order.expireTime).getTime() <= now;
        const paidOnWx = order.prepayId && subMchId &&
          cloud.cloudPay && typeof cloud.cloudPay.queryOrder === 'function'
          ? await queryOrderState(subMchId, order.orderNo)
          : null;
        if (paidOnWx && paidOnWx.tradeState === 'SUCCESS') {
          await confirmPayment({
            outTradeNo: order.orderNo,
            transactionId: paidOnWx.transactionId,
            totalFee: paidOnWx.totalFee,
            source: 'reconcile'
          });
          console.log('[order] 对账补齐已支付订单:', order.orderNo);
          continue;
        }
        if (expired && order.inventoryStatus === 'reserved') {
          const closed = await releaseOrderReservations(order, 'payment_timeout');
          if (closed) console.log('[order] 对账关闭过期未支付订单:', order.orderNo);
        }
      } catch (err) {
        console.error('[order] 对账失败:', order.orderNo, err && (err.message || err));
      }
    }
  } catch (err) {
    console.warn('[order] 对账流程异常:', err && (err.message || err));
  }
}

async function queryOrderState(subMchId, orderNo) {
  try {
    const query = await cloud.cloudPay.queryOrder({
      subMchId, outTradeNo: orderNo, nonceStr: generateNonceStr()
    });
    if (!query) return null;
    const totalFeeValue = query.totalFee !== undefined ? query.totalFee : query.total_fee;
    return {
      tradeState: query.tradeState || query.trade_state || '',
      transactionId: query.transactionId || query.transaction_id || '',
      totalFee: totalFeeValue === undefined ? null : Number(totalFeeValue)
    };
  } catch (err) {
    console.warn('[order] 查单失败:', orderNo, err && (err.message || err));
    return null;
  }
}

function updatedCount(result) {
  return result && result.stats ? result.stats.updated : result && result.updated;
}

function withTransaction(work) {
  return typeof db.runTransaction === 'function' ? db.runTransaction(work) : work(db);
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function normalizeAddress(address) {
  const normalized = {
    name: String((address && address.name) || '').trim(),
    phone: String((address && address.phone) || '').trim(),
    region: Array.isArray(address && address.region) ? address.region.slice(0, 3).map(item => String(item).slice(0, 30)) : [],
    detail: String((address && address.detail) || '').trim()
  };
  if (!normalized.name || normalized.name.length > 30) throw new Error('收货人姓名无效');
  if (!/^1\d{10}$/.test(normalized.phone)) throw new Error('手机号格式不正确');
  if (!normalized.detail || normalized.detail.length > 200) throw new Error('详细地址无效');
  return normalized;
}

function findSpec(product, specName) {
  const specs = Array.isArray(product.specs) ? product.specs : [];
  if (!specs.length) return null;
  return specs.find(spec => spec.name === specName) || specs[0];
}

function availableStock(product, spec) {
  const stock = Number(spec ? spec.stock : product.stock) || 0;
  const reserved = Number(spec ? spec.reservedStock : product.reservedStock) || 0;
  return stock - reserved;
}

async function resolveFullReduction(database, amount) {
  try {
    const cfgRes = await database.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (cfgRes && cfgRes.data) || {};
    const fr = cfg.fullReduction;
    if (!fr || fr.enabled !== true) return 0;
    const rules = Array.isArray(fr.rules) ? fr.rules : [];
    let best = 0;
    for (const rule of rules) {
      const threshold = Number(rule && rule.threshold) || 0;
      const discount = Number(rule && rule.discount) || 0;
      if (threshold > 0 && discount > 0 && amount >= threshold && discount > best) best = discount;
    }
    return Math.min(best, amount);
  } catch (e) {
    return 0;
  }
}

async function resolveCouponDiscount(database, userCouponId, userId, amount) {
  if (!userCouponId) return 0;
  const userCouponRes = await database.collection('user_coupons').doc(userCouponId).get().catch(() => null);
  const userCoupon = userCouponRes && userCouponRes.data;
  if (!userCoupon || userCoupon.userId !== userId) throw new Error('优惠券不存在或无权使用');
  if (userCoupon.status !== 'unused') throw new Error('优惠券已使用或已失效');
  const couponRes = await database.collection('coupons').doc(userCoupon.couponId).get().catch(() => null);
  const coupon = couponRes && couponRes.data;
  if (!coupon || coupon.status === 'off') throw new Error('优惠券已下架');
  const now = Date.now();
  if ((coupon.startTime && Number(coupon.startTime) > now) ||
      (coupon.endTime && Number(coupon.endTime) < now)) throw new Error('优惠券不在有效期内');
  if (amount < (Number(coupon.minSpend) || 0)) throw new Error('订单金额未达到优惠券使用门槛');
  if (coupon.type === 'amount') return Math.min(Math.max(0, Number(coupon.value) || 0), amount);
  if (coupon.type === 'percent') {
    return Math.min(Math.floor(amount * Math.max(0, Number(coupon.value) || 0) / 100), amount);
  }
  throw new Error('优惠券类型无效');
}

function reserveProduct(product, specName, quantity) {
  const specs = Array.isArray(product.specs) ? product.specs.map(spec => ({ ...spec })) : [];
  const specIndex = specs.findIndex(spec => spec.name === specName);
  if (specIndex >= 0) {
    specs[specIndex].reservedStock = (Number(specs[specIndex].reservedStock) || 0) + quantity;
  }
  return {
    specs,
    reservedStock: (Number(product.reservedStock) || 0) + quantity
  };
}

function releaseProduct(product, specName, quantity) {
  const specs = Array.isArray(product.specs) ? product.specs.map(spec => ({ ...spec })) : [];
  const specIndex = specs.findIndex(spec => spec.name === specName);
  if (specIndex >= 0) {
    specs[specIndex].reservedStock = Math.max(0, (Number(specs[specIndex].reservedStock) || 0) - quantity);
  }
  return {
    specs,
    reservedStock: Math.max(0, (Number(product.reservedStock) || 0) - quantity)
  };
}

async function getCommissionRate(database = db) {
  try {
    const payRes = await database.collection('pay_config').doc('default').get().catch(() => null);
    if (payRes && payRes.data && typeof payRes.data.commissionRate === 'number') return payRes.data.commissionRate;
    const adminRes = await database.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (adminRes && adminRes.data) || {};
    return typeof cfg.commissionRate === 'number' ? cfg.commissionRate : 0.33;
  } catch (e) {
    return 0.33;
  }
}

async function resolveActiveAgentId(referrerId, buyerOpenId, database = db) {
  const candidate = String(referrerId || '').trim();
  if (!candidate || candidate === buyerOpenId) return '';
  const agentRes = await database.collection('users').doc(candidate).get().catch(() => null);
  const agent = agentRes && agentRes.data;
  return agent && agent.isAgent && agent.agentInfo && agent.agentInfo.status === 'active' ? candidate : '';
}

async function releaseOrderReservations(order, reason) {
  return withTransaction(async transaction => {
    const currentRes = await transaction.collection('orders').doc(order._id).get().catch(() => null);
    const current = currentRes && currentRes.data;
    if (!current || current.status !== 'pending' || current.inventoryStatus !== 'reserved') return false;
    const reservationRes = await transaction.collection('inventory_reservations')
      .where({ orderId: order._id, status: 'reserved' }).get();
    for (const reservation of reservationRes.data || []) {
      const productRes = await transaction.collection('products').doc(reservation.productId).get();
      if (!productRes.data) continue;
      const next = releaseProduct(productRes.data, reservation.spec, reservation.quantity);
      await transaction.collection('products').doc(reservation.productId).update({
        data: { ...next, updateTime: db.serverDate() }
      });
      await transaction.collection('inventory_reservations').doc(reservation._id).update({
        data: { status: 'released', releaseReason: reason, releaseTime: db.serverDate() }
      });
    }
    await transaction.collection('orders').doc(order._id).update({
      data: {
        status: 'closed', inventoryStatus: 'released', closeReason: reason,
        closeTime: db.serverDate(), updateTime: db.serverDate()
      }
    });
    return true;
  });
}

async function settleCommission(orderId) {
  return withTransaction(async transaction => {
    const orderRes = await transaction.collection('orders').doc(orderId).get().catch(() => null);
    const order = orderRes && orderRes.data;
    if (!order || order.status !== 'shipped') return { success: false, error: '当前订单状态不可确认收货' };
    if (order.agentId) {
      await transaction.collection('commissions').where({ orderId, status: 'frozen' }).update({
        data: { status: 'settled', settleTime: db.serverDate(), settleSource: 'customer_receive' }
      });
    }
    await transaction.collection('orders').doc(orderId).update({ data: {
      status: 'received', receivedTime: db.serverDate(),
      commissionStatus: order.agentId ? 'settled' : 'none', updateTime: db.serverDate()
    } });
    return { success: true };
  });
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const OPENID = ctx.OPENID || '';
  if (!OPENID) return { success: false, error: '缺少可信微信身份，请从小程序重新登录' };
  try {
    switch (event.action) {
      case 'create': {
        const { orderNo, items, totalFee, address, remark } = event;
        if (!Array.isArray(items) || items.length === 0) return { success: false, error: '订单商品为空' };
        if (!/^JY\d{14}[A-Z0-9]{6}$/.test(String(orderNo || ''))) {
          return { success: false, error: '订单号格式无效，请重试' };
        }
        const safeAddress = normalizeAddress(address);
        const duplicate = await db.collection('orders').where({ orderNo }).count();
        if (duplicate.total > 0) return { success: false, error: '订单号已存在，请重试' };

        const userRes = await db.collection('users').doc(OPENID).get().catch(() => null);
        const user = (userRes && userRes.data) || {};
        const agentId = await resolveActiveAgentId(user.referrer, OPENID);
        const commissionRate = await getCommissionRate();
        const result = await withTransaction(async transaction => {
          let calculatedTotal = 0;
          const enrichedItems = [];
          const productUpdates = [];
          for (const item of items) {
            const quantity = normalizeQuantity(item.quantity);
            if (!item.productId || !quantity) throw new Error('商品参数无效');
            const productRes = await transaction.collection('products').doc(item.productId).get().catch(() => null);
            const product = productRes && productRes.data;
            if (!product || product.status !== 'on') throw new Error('商品不存在或已下架');
            if (item.spec && Array.isArray(product.specs) && product.specs.length &&
                !product.specs.some(spec => spec.name === item.spec)) throw new Error('商品规格不存在: ' + product.name);
            const spec = findSpec(product, item.spec || '');
            const specName = spec ? spec.name : '';
            if (availableStock(product, spec) < quantity) throw new Error('库存不足: ' + product.name);
            const unitPrice = Number(spec && spec.price) || Number(product.price) || 0;
            calculatedTotal += unitPrice * quantity;
            enrichedItems.push({
              productId: product._id, name: product.name, spec: specName,
              image: (product.images && product.images[0]) || '', quantity, price: unitPrice
            });
            productUpdates.push({ product, specName, quantity });
          }

          const fullReductionDiscount = await resolveFullReduction(transaction, calculatedTotal);
          if (event.fullReductionDiscount !== undefined && Number(event.fullReductionDiscount) !== fullReductionDiscount) {
            throw new Error('优惠信息已变化，请刷新后重试');
          }
          const couponDiscount = await resolveCouponDiscount(transaction, event.couponId || '', OPENID, calculatedTotal - fullReductionDiscount);
          if (event.couponDiscount !== undefined && Number(event.couponDiscount) !== couponDiscount) {
            throw new Error('优惠信息已变化，请刷新后重试');
          }
          const actualTotalFee = calculatedTotal - couponDiscount - fullReductionDiscount;
          if (!Number.isInteger(actualTotalFee) || actualTotalFee < 1) {
            throw new Error('应付金额必须至少为0.01元');
          }
          // 安全设计：以服务端计算的金额为准，忽略客户端传的 totalFee，
          // 避免多规格不同价商品在客户端算错金额时下不了单。
          // 客户端传的金额仅用于比对告警（不再作为下单硬性条件）。
          if (typeof totalFee === 'number' && Number(totalFee) !== actualTotalFee) {
            console.warn('[order] 客户端金额与服务端不一致, 已采用服务端金额:', {
              orderNo, clientTotal: totalFee, serverTotal: actualTotalFee
            });
          }
          for (const update of productUpdates) {
            const latestRes = await transaction.collection('products').doc(update.product._id).get();
            const latestSpec = findSpec(latestRes.data, update.specName);
            if (availableStock(latestRes.data, latestSpec) < update.quantity) throw new Error('库存不足: ' + update.product.name);
            const next = reserveProduct(latestRes.data, update.specName, update.quantity);
            await transaction.collection('products').doc(update.product._id).update({
              data: { ...next, updateTime: db.serverDate() }
            });
          }

          const expireTime = new Date(Date.now() + ORDER_EXPIRE_MS);
          const orderResult = await transaction.collection('orders').add({ data: {
            orderNo, userId: OPENID, items: enrichedItems, totalFee: actualTotalFee,
            originalTotalFee: calculatedTotal, couponDiscount, couponId: event.couponId || '',
            fullReductionDiscount,
            status: 'pending', inventoryStatus: 'reserved', address: safeAddress, logistics: null, agentId,
            commission: agentId ? Math.round(actualTotalFee * commissionRate) : 0,
            commissionRate: agentId ? commissionRate : 0,
            commissionStatus: agentId ? 'pending' : 'none', remark: String(remark || '').slice(0, 200),
            createTime: db.serverDate(), expireTime, payTime: null, updateTime: db.serverDate()
          } });
          for (const [reservationIndex, update] of productUpdates.entries()) {
            await transaction.collection('inventory_reservations').add({ data: {
              idempotencyKey: `reservation:${orderNo}:${reservationIndex}`,
              orderId: orderResult._id, orderNo, productId: update.product._id,
              spec: update.specName, quantity: update.quantity, status: 'reserved',
              expireTime, createTime: db.serverDate()
            } });
          }
          if (event.couponId) {
            await transaction.collection('user_coupons').doc(event.couponId).update({ data: {
              status: 'used', useTime: db.serverDate(), orderId: orderResult._id, updateTime: db.serverDate()
            } });
          }
          return { orderId: orderResult._id, actualTotalFee, calculatedTotal, couponDiscount, fullReductionDiscount };
        });

        try {
          const cartRes = await db.collection('cart').where({ userId: OPENID }).get();
          if (cartRes.data.length > 0) {
            const cart = cartRes.data[0];
            const removeKeys = (event.removeCartKeys || []).map(String);
            const remaining = (cart.items || []).filter(item => !removeKeys.includes(`${item.productId}_${item.spec || ''}`));
            await db.collection('cart').doc(cart._id).update({ data: { items: remaining, updateTime: db.serverDate() } });
          }
        } catch (e) {}
        return { success: true, orderId: result.orderId, totalFee: result.actualTotalFee,
          originalTotalFee: result.calculatedTotal, couponDiscount: result.couponDiscount,
          fullReductionDiscount: result.fullReductionDiscount };
      }

      case 'list': {
        const pageSize = Math.min(Number(event.pageSize) || 20, 50);
        const page = Math.max(Number(event.page) || 1, 1);
        const query = { userId: OPENID };
        if (event.status) query.status = event.status;
        const countRes = await db.collection('orders').where(query).count().catch(() => ({ total: 0 }));
        const res = await db.collection('orders').where(query).orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize).limit(pageSize).get();
        return { success: true, data: res.data, total: countRes.total || 0 };
      }

      case 'counts': {
        await reconcilePendingOrders(OPENID);
        const statuses = ['pending', 'paid', 'shipped', 'refunding'];
        const data = { pending: 0, paid: 0, shipped: 0, refunding: 0 };
        await Promise.all(statuses.map(async status => {
          const res = await db.collection('orders').where({ userId: OPENID, status }).count().catch(() => ({ total: 0 }));
          data[status] = res.total || 0;
        }));
        return { success: true, data };
      }

      case 'detail': {
        if (!event.id) return { success: false, error: '缺少订单ID' };
        const res = await db.collection('orders').doc(event.id).get().catch(() => null);
        if (!res || !res.data || res.data.userId !== OPENID) return { success: false, error: '订单不存在或无权限' };
        return { success: true, data: res.data };
      }

      case 'updateStatus': {
        if (event.status !== 'received') return { success: false, error: '不允许的状态变更' };
        const orderRes = await db.collection('orders').doc(event.id).get().catch(() => null);
        const order = orderRes && orderRes.data;
        if (!order || order.userId !== OPENID) return { success: false, error: '订单不存在或无权限' };
        return settleCommission(event.id);
      }

      case 'requestRefund': {
        if (!event.reason) return { success: false, error: '请选择退款原因' };
        return withTransaction(async transaction => {
          const orderRes = await transaction.collection('orders').doc(event.id).get().catch(() => null);
          const order = orderRes && orderRes.data;
          if (!order || order.userId !== OPENID) return { success: false, error: '订单不存在或无权限' };
          if (order.status === 'refunding' && order.refundId) {
            return { success: true, refundId: order.refundId, duplicate: true };
          }
          if (!['paid', 'shipped', 'received'].includes(order.status)) {
            return { success: false, error: '当前订单状态不支持售后' };
          }
          const exist = await transaction.collection('refunds')
            .where({ orderId: order._id, status: 'pending' })
            .limit(1)
            .get();
          if (exist.data && exist.data[0]) {
            return { success: true, refundId: exist.data[0]._id, duplicate: true };
          }
          const refundType = order.status === 'paid' ? 'refund_only' : 'return_refund';
          const refundAttempt = (Number(order.refundAttempt) || 0) + 1;
          const refundResult = await transaction.collection('refunds').add({ data: {
            idempotencyKey: `refund_request:${order._id}:${refundAttempt}`,
            orderId: order._id, orderNo: order.orderNo, userId: OPENID, prevStatus: order.status,
            type: refundType, reason: String(event.reason).slice(0, 100),
            description: String(event.description || '').slice(0, 1000),
            images: Array.isArray(event.images) ? event.images.slice(0, 6) : [], status: 'pending',
            returnStatus: refundType === 'return_refund' ? 'awaiting_return' : 'not_required',
            restock: false, adminNote: '', createTime: db.serverDate(), processTime: null
          } });
          await transaction.collection('orders').doc(order._id).update({ data: {
            status: 'refunding', refundId: refundResult._id, refundAttempt, updateTime: db.serverDate()
          } });
          return { success: true, refundId: refundResult._id, refundType };
        });
      }

      case 'refundDetail': {
        if (!event.id) return { success: false, error: '缺少售后ID' };
        const res = await db.collection('refunds').doc(event.id).get().catch(() => null);
        if (!res || !res.data || res.data.userId !== OPENID) return { success: false, error: '售后记录不存在或无权限' };
        return { success: true, data: res.data };
      }

      case 'myRefunds': {
        const pageSize = Math.min(Number(event.pageSize) || 20, 50);
        const page = Math.max(Number(event.page) || 1, 1);
        const query = { userId: OPENID };
        const countRes = await db.collection('refunds').where(query).count().catch(() => ({ total: 0 }));
        const res = await db.collection('refunds').where(query).orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize).limit(pageSize).get();
        return { success: true, data: res.data, total: countRes.total || 0 };
      }

      case 'cancel': {
        const orderRes = await db.collection('orders').doc(event.id).get().catch(() => null);
        const order = orderRes && orderRes.data;
        if (!order || order.userId !== OPENID) return { success: false, error: '订单不存在或无权限' };
        if (order.status !== 'pending') return { success: false, error: '当前订单状态不可取消' };
        const closed = await releaseOrderReservations(order, 'customer_cancel');
        return closed ? { success: true } : { success: false, error: '订单状态已变化，请刷新' };
      }

      default:
        return { success: false, error: 'unknown action' };
    }
  } catch (err) {
    console.error('[order] 运行时错误:', err);
    return { success: false, error: (err && err.message) || '订单处理失败' };
  }
};
