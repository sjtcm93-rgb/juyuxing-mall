const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 佣金比例（下单时一并写入订单的 commission 字段，便于后续核对）
const COMMISSION_RATE = 0.15;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  switch (event.action) {
    case 'create': {
      const { orderNo, items, totalFee, address, remark } = event;

      // 基础入参校验
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: '订单商品为空' };
      }
      if (!address || !address.name || !address.phone || !address.detail) {
        return { success: false, error: '收货地址不完整' };
      }
      if (!orderNo) {
        return { success: false, error: '订单号缺失' };
      }

      // 服务端重新计算总价 & 校验库存 / 上下架
      let calculatedTotal = 0;
      const enrichedItems = [];
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity < 1) {
          return { success: false, error: '商品参数无效' };
        }
        let prod;
        try {
          const prodRes = await db.collection('products').doc(item.productId).get();
          prod = prodRes.data;
        } catch (e) {
          return { success: false, error: '商品不存在或已下架' };
        }
        if (!prod) {
          return { success: false, error: '商品不存在: ' + item.productId };
        }
        if (prod.status !== 'on') {
          return { success: false, error: '商品已下架: ' + prod.name };
        }
        const spec = prod.specs && prod.specs.find(s => s.name === item.spec);
        if (spec && typeof spec.stock === 'number' && spec.stock < item.quantity) {
          return { success: false, error: '库存不足: ' + prod.name };
        }
        const unitPrice = prod.price;
        calculatedTotal += unitPrice * item.quantity;
        enrichedItems.push({
          productId: prod._id,
          name: prod.name,
          spec: item.spec || (prod.specs && prod.specs[0] && prod.specs[0].name) || '',
          image: (prod.images && prod.images[0]) || '',
          quantity: item.quantity,
          price: unitPrice
        });
      }

      // 防前端篡改：金额对不上就报错
      if (typeof totalFee === 'number' && totalFee !== calculatedTotal) {
        return { success: false, error: '订单金额不一致，请刷新后重试' };
      }

      // 取代理关系（首次注册时由 login 写入 referrer）
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null);
      const user = userRes?.data || {};
      const agentId = user.referrer || '';

      const orderData = {
        orderNo,
        userId: OPENID,
        items: enrichedItems,
        totalFee: calculatedTotal,
        status: 'pending',
        address,
        logistics: null,
        agentId,
        commission: agentId ? Math.round(calculatedTotal * COMMISSION_RATE) : 0,
        commissionStatus: agentId ? 'pending' : 'none',
        remark: remark || '',
        createTime: db.serverDate(),
        payTime: null
      };

      const res = await db.collection('orders').add({ data: orderData });

      // 下单成功后清空该用户的购物车
      try {
        const cartRes = await db.collection('cart').where({ userId: OPENID }).get();
        if (cartRes.data.length > 0) {
          await db.collection('cart').doc(cartRes.data[0]._id).update({
            data: { items: [], updateTime: db.serverDate() }
          });
        }
      } catch (e) {
        // 购物车清理失败不影响订单创建
      }

      return { success: true, orderId: res._id, totalFee: calculatedTotal };
    }

    case 'list': {
      const pageSize = event.pageSize || 20;
      const page = event.page || 1;
      let query = { userId: OPENID };
      if (event.status) query.status = event.status;
      const res = await db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data };
    }

    case 'detail': {
      const res = await db.collection('orders').doc(event.id).get();
      return { success: true, data: res.data };
    }

    case 'updateStatus': {
      const orderId = event.id;
      const newStatus = event.status;
      const updateData = { status: newStatus };
      if (newStatus === 'paid') {
        updateData.payTime = db.serverDate();
      }
      await db.collection('orders').doc(orderId).update({ data: updateData });

      // 订单支付成功时自动计算佣金（15%）
      if (newStatus === 'paid') {
        const orderRes = await db.collection('orders').doc(orderId).get();
        const order = orderRes.data;
        if (order && order.agentId && order.agentId !== '') {
          const amount = Math.round(order.totalFee * COMMISSION_RATE);
          await db.collection('commissions').add({
            data: {
              agentId: order.agentId,
              orderId: order._id,
              orderNo: order.orderNo,
              amount: amount,
              rate: COMMISSION_RATE,
              status: 'pending',
              createTime: db.serverDate(),
              settleTime: null
            }
          });
          await db.collection('orders').doc(orderId).update({
            data: { commission: amount, commissionStatus: 'pending' }
          });
        }
      }
      return { success: true };
    }

    case 'cancel': {
      await db.collection('orders').doc(event.id).update({
        data: { status: 'cancelled' }
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'unknown action' };
  }
};
