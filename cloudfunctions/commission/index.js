const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  
  switch (event.action) {
    case 'calculate': {
      // 订单支付成功后计算佣金
      const orderId = event.orderId;
      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;
      if (!order || !order.agentId || order.agentId === '') {
        return { success: true, commission: 0 };
      }
      // 佣金比例 15%
      const rate = 0.15;
      const amount = Math.round(order.totalFee * rate);
      await db.collection('commissions').add({
        data: {
          agentId: order.agentId,
          orderId: order._id,
          orderNo: order.orderNo,
          amount: amount,
          rate: rate,
          status: 'pending',
          createTime: db.serverDate(),
          settleTime: null
        }
      });
      // 更新订单佣金信息
      await db.collection('orders').doc(orderId).update({
        data: {
          commission: amount,
          commissionStatus: 'pending'
        }
      });
      return { success: true, commission: amount };
    }
    case 'settle': {
      // 手动结算佣金（管理后台操作）
      const commissionId = event.commissionId;
      await db.collection('commissions').doc(commissionId).update({
        data: {
          status: 'settled',
          settleTime: db.serverDate()
        }
      });
      return { success: true };
    }
    case 'list': {
      const pageSize = event.pageSize || 20;
      const page = event.page || 1;
      const res = await db.collection('commissions')
        .where({ agentId: OPENID })
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data };
    }
    default:
      return { success: false, error: 'unknown action' };
  }
};
