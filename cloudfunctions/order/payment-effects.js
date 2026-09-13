'use strict';

function createPaymentEffects(cloud, db) {
  function withTransaction(work) {
    return typeof db.runTransaction === 'function' ? db.runTransaction(work) : work(db);
  }

  function commitProduct(product, specName, quantity) {
    const specs = Array.isArray(product.specs) ? product.specs.map(spec => ({ ...spec })) : [];
    const specIndex = specs.findIndex(spec => spec.name === specName);
    if (specIndex >= 0) {
      specs[specIndex].stock = Math.max(0, (Number(specs[specIndex].stock) || 0) - quantity);
      specs[specIndex].reservedStock = Math.max(0, (Number(specs[specIndex].reservedStock) || 0) - quantity);
    }
    return {
      specs,
      stock: Math.max(0, (Number(product.stock) || 0) - quantity),
      reservedStock: Math.max(0, (Number(product.reservedStock) || 0) - quantity),
      sales: (Number(product.sales) || 0) + quantity
    };
  }

  async function findOrder(database, options) {
    if (options.orderId) {
      const res = await database.collection('orders').doc(options.orderId).get().catch(() => null);
      return res && res.data;
    }
    const res = await database.collection('orders').where({ orderNo: options.outTradeNo }).limit(1).get();
    return res.data && res.data[0];
  }

  async function ensureLedger(database, collectionName, idempotencyKey, data) {
    const exists = await database.collection(collectionName).where({ idempotencyKey }).count();
    if (exists.total > 0) return false;
    await database.collection(collectionName).add({ data: { ...data, idempotencyKey } });
    return true;
  }

  return async function confirmPayment(options) {
    return withTransaction(async transaction => {
      const order = await findOrder(transaction, options);
      if (!order) throw new Error('订单不存在');
      if (!['pending', 'paid', 'shipped', 'received'].includes(order.status)) throw new Error('订单状态不可支付');
      if (options.totalFee !== null && options.totalFee !== undefined &&
          Number(options.totalFee) !== Number(order.totalFee)) {
        throw new Error('支付金额与订单金额不一致');
      }
      if (options.payerOpenId && order.userId && options.payerOpenId !== order.userId) {
        throw new Error('付款身份与订单用户不一致');
      }

      if (order.inventoryStatus === 'reserved') {
        const reservations = await transaction.collection('inventory_reservations')
          .where({ orderId: order._id, status: 'reserved' }).get();
        for (const reservation of reservations.data || []) {
          const productRes = await transaction.collection('products').doc(reservation.productId).get();
          if (!productRes.data) throw new Error('库存商品不存在');
          const next = commitProduct(productRes.data, reservation.spec, Number(reservation.quantity) || 0);
          await transaction.collection('products').doc(reservation.productId).update({
            data: { ...next, updateTime: db.serverDate() }
          });
          await transaction.collection('inventory_reservations').doc(reservation._id).update({
            data: { status: 'committed', commitTime: db.serverDate() }
          });
        }
      }

      const updateData = {
        inventoryStatus: 'committed',
        transactionId: options.transactionId || order.transactionId || '',
        paymentSource: options.source || order.paymentSource || 'payment',
        updateTime: db.serverDate()
      };
      if (order.status === 'pending') {
        updateData.status = 'paid';
        updateData.payTime = db.serverDate();
      }

      await ensureLedger(transaction, 'cashflow_entries', 'payment:' + order._id, {
        type: 'sale_receipt', direction: 'in', amount: Number(order.totalFee) || 0,
        orderId: order._id, orderNo: order.orderNo, source: options.source || 'payment',
        status: 'posted', createTime: db.serverDate()
      });

      if (order.agentId && Number(order.commission) > 0) {
        const existingCommission = await transaction.collection('commissions')
          .where({ orderId: order._id, type: 'earning' }).count();
        if (existingCommission.total === 0) await ensureLedger(transaction, 'commissions', 'commission:' + order._id, {
          type: 'earning', agentId: order.agentId, orderId: order._id, orderNo: order.orderNo,
          amount: Number(order.commission), rate: Number(order.commissionRate) || 0,
          status: 'frozen', createTime: db.serverDate(), settleTime: null, paidTime: null,
          source: options.source || 'payment'
        });
        updateData.commissionStatus = 'frozen';
      }

      await transaction.collection('orders').doc(order._id).update({ data: updateData });
      return { orderId: order._id, orderNo: order.orderNo, status: updateData.status || order.status };
    });
  };
}

module.exports = { createPaymentEffects };
