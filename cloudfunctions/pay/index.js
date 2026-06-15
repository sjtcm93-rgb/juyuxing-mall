const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 当前为模拟支付模式：
// - 未开通微信支付商户号时，直接把订单置为 paid
// - 状态变更的副作用（佣金创建）交由 order.updateStatus 统一处理，
//   避免佣金比例 / 逻辑分散在两个云函数中
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  switch (event.action) {
    case 'request': {
      const orderId = event.orderId;
      if (!orderId) {
        return { success: false, error: '订单号缺失' };
      }

      // 仅允许本人支付自己的订单
      const orderRes = await db.collection('orders').doc(orderId).get().catch(() => null);
      const order = orderRes?.data;
      if (!order) {
        return { success: false, error: '订单不存在' };
      }
      if (order.userId !== OPENID) {
        return { success: false, error: '无权操作此订单' };
      }
      if (order.status === 'paid' || order.status === 'shipped' || order.status === 'received') {
        return { success: true, mock: true, message: '订单已支付', orderId };
      }
      if (order.status !== 'pending') {
        return { success: false, error: '当前订单状态不可支付' };
      }

      // 复用 order 云函数的更新逻辑，佣金 / 状态都在一处维护
      const updateRes = await cloud.callFunction({
        name: 'order',
        data: { action: 'updateStatus', id: orderId, status: 'paid' }
      });
      if (!updateRes.result || !updateRes.result.success) {
        return { success: false, error: '订单状态更新失败' };
      }

      return {
        success: true,
        mock: true,
        message: '模拟支付成功（待微信支付商户号接入后替换为真实支付）',
        orderId
      };
    }
    default:
      return { success: false, error: 'unknown action' };
  }
};
