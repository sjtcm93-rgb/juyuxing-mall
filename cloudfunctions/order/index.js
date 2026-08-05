const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

// 从 admin_config 读取佣金比例（默认 15%）
async function getCommissionRate() {
  try {
    const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (adminRes && adminRes.data) || {};
    return typeof cfg.commissionRate === 'number' ? cfg.commissionRate : 0.15;
  } catch (e) {
    return 0.15;
  }
}

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
      // 注意：优惠券折扣已从前端 totalFee 中扣除,服务端校验时需要把它从 calculatedTotal 中减回去
      if (typeof totalFee === 'number') {
        const couponDiscount = Number(event.couponDiscount) || 0;
        const expectedTotal = calculatedTotal - couponDiscount;
        if (totalFee !== expectedTotal) {
          return { success: false, error: '订单金额不一致，请刷新后重试' };
        }
      }

      // 取代理关系（首次注册时由 login 写入 referrer）
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null);
      const user = (userRes && userRes.data) || {};
      const agentId = user.referrer || '';

      // 实付金额 = 商品总价 - 优惠券折扣；佣金按实付金额计算,避免对"原价"抽佣
      const couponDiscount = Number(event.couponDiscount) || 0;
      const actualTotalFee = calculatedTotal - couponDiscount;

      const orderData = {
        orderNo,
        userId: OPENID,
        items: enrichedItems,
        totalFee: actualTotalFee,
        originalTotalFee: calculatedTotal,
        couponDiscount: couponDiscount,
        couponId: event.couponId || '',
        status: 'pending',
        address,
        logistics: null,
        agentId,
        commission: agentId ? Math.round(actualTotalFee * await getCommissionRate()) : 0,
        commissionStatus: agentId ? 'pending' : 'none',
        remark: remark || '',
        createTime: db.serverDate(),
        payTime: null
      };

      const res = await db.collection('orders').add({ data: orderData });

      // 下单成功后只移除已结算的商品，保留购物车中其余未结算商品
      try {
        const cartRes = await db.collection('cart').where({ userId: OPENID }).get();
        if (cartRes.data.length > 0) {
          const cart = cartRes.data[0];
          const removeKeys = (event.removeCartKeys || []).map(k => String(k));
          const remaining = (cart.items || []).filter(it =>
            !removeKeys.includes(`${it.productId}_${it.spec || ''}`)
          );
          await db.collection('cart').doc(cart._id).update({
            data: { items: remaining, updateTime: db.serverDate() }
          });
        }
      } catch (e) {
        // 购物车清理失败不影响订单创建
      }

      return { success: true, orderId: res._id, totalFee: actualTotalFee, originalTotalFee: calculatedTotal, couponDiscount };
    }

    case 'list': {
      const pageSize = event.pageSize || 20;
      const page = event.page || 1;
      let query = { userId: OPENID };
      if (event.status) query.status = event.status;
      const countRes = await db.collection('orders').where(query).count().catch(() => ({ total: 0 }));
      const res = await db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data, total: countRes.total || 0 };
    }

    case 'detail': {
      if (!event.id) {
        return { success: false, error: '缺少订单ID' };
      }
      try {
        const res = await db.collection('orders').doc(event.id).get();
        return { success: true, data: res.data };
      } catch (e) {
        return { success: false, error: '订单不存在或已删除' };
      }
    }

    case 'updateStatus': {
      const orderId = event.id;
      const newStatus = event.status;

      // 校验订单归属（只有订单本人才能操作）
      const ordRes = await db.collection('orders').doc(orderId).get().catch(() => null);
      if (!ordRes || !ordRes.data) {
        return { success: false, error: '订单不存在' };
      }
      if (ordRes.data.userId !== OPENID) {
        return { success: false, error: '无权操作此订单' };
      }

      // 状态流转校验：只有 shipped → received 允许用户自行操作
      if (newStatus === 'received' && ordRes.data.status !== 'shipped') {
        return { success: false, error: '当前订单状态不可确认收货' };
      }

      const updateData = { status: newStatus };
      if (newStatus === 'paid') {
        updateData.payTime = db.serverDate();
      }
      if (newStatus === 'received') {
        updateData.receivedTime = db.serverDate();
      }
      // 记录微信支付交易号（来自支付回调）
      if (event.transactionId) {
        updateData.transactionId = event.transactionId;
      }
      await db.collection('orders').doc(orderId).update({ data: updateData });

      // 注意：佣金结算由 payNotify 云函数负责（支付回调时直接写入 settled）
      // 这里不再处理佣金，避免重复写入
      return { success: true };
    }

    case 'requestRefund': {
      // 用户申请退款
      const orderId = event.id;
      const { reason, description } = event;
      if (!reason) {
        return { success: false, error: '请选择退款原因' };
      }

      // 校验订单归属
      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;
      if (!order || order.userId !== OPENID) {
        return { success: false, error: '订单不存在或无权限' };
      }
      // 只有已支付/已发货/已收货的订单可以申请退款
      if (!['paid', 'shipped', 'received'].includes(order.status)) {
        return { success: false, error: '当前订单状态不支持退款' };
      }

      // 防止重复申请（已有退款记录且状态为 pending）
      const existRefund = await db.collection('refunds')
        .where({ orderId: orderId, status: 'pending' })
        .count();
      if (existRefund.total > 0) {
        return { success: false, error: '退款申请已提交，请耐心等待处理' };
      }

      // 记录原状态，便于拒绝时恢复
      const prevStatus = order.status;

      // 创建退款申请记录
      const refundId = await db.collection('refunds').add({
        data: {
          orderId: order._id,
          orderNo: order.orderNo,
          userId: OPENID,
          prevStatus: prevStatus,
          reason: reason,
          description: description || '',
          images: [],
          status: 'pending',
          adminNote: '',
          createTime: db.serverDate(),
          processTime: null
        }
      });

      // 更新订单状态为退款中
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'refunding',
          refundId: refundId._id
        }
      });

      return { success: true };
    }

    case 'refundDetail': {
      // 用户查看自己的退款详情
      const refundId = event.id;
      if (!refundId) return { success: false, error: '缺少退款ID' };
      const refundRes = await db.collection('refunds').doc(refundId).get().catch(() => null);
      const refund = refundRes && refundRes.data;
      if (!refund) return { success: false, error: '退款记录不存在' };
      // 归属校验：只能看自己的退款
      if (refund.userId !== OPENID) return { success: false, error: '无权查看该退款' };
      return { success: true, data: refund };
    }

    case 'myRefunds': {
      // 查询当前用户的退款申请列表
      const pageSize = event.pageSize || 20;
      const page = event.page || 1;
      const countRes = await db.collection('refunds').where({ userId: OPENID }).count().catch(() => ({ total: 0 }));
      const res = await db.collection('refunds')
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data, total: countRes.total || 0 };
    }

    case 'cancel': {
      const orderId = event.id;
      // 校验订单归属
      const cancelRes = await db.collection('orders').doc(orderId).get().catch(() => null);
      if (!cancelRes || !cancelRes.data) {
        return { success: false, error: '订单不存在' };
      }
      if (cancelRes.data.userId !== OPENID) {
        return { success: false, error: '无权操作此订单' };
      }
      // 只有待支付订单可以取消
      if (cancelRes.data.status !== 'pending') {
        return { success: false, error: '当前订单状态不可取消' };
      }
      await db.collection('orders').doc(orderId).update({
        data: { status: 'cancelled', cancelTime: db.serverDate() }
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'unknown action' };
  }
};
