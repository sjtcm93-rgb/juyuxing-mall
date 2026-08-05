const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

// 判断是否为管理员（与 admin 云函数保持一致）
async function checkIsAdmin(openid) {
  try {
    const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (adminRes && adminRes.data) || {};
    const adminOpenIds = cfg.adminOpenIds || [];
    const legacyOpenId = cfg.openId || '';
    return !!(openid && (openid === legacyOpenId || adminOpenIds.includes(openid)));
  } catch (e) {
    return false;
  }
}

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
    case 'calculate': {
      // 管理员权限校验
      if (!await checkIsAdmin(OPENID)) {
        return { success: false, error: '无权限' };
      }
      const orderId = event.orderId;
      const orderRes = await db.collection('orders').doc(orderId).get();
      const order = orderRes.data;
      if (!order || !order.agentId || order.agentId === '') {
        return { success: true, commission: 0 };
      }
      const rate = await getCommissionRate();
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
      await db.collection('orders').doc(orderId).update({
        data: {
          commission: amount,
          commissionStatus: 'pending'
        }
      });
      return { success: true, commission: amount };
    }
    case 'settle': {
      // 管理员权限校验
      if (!await checkIsAdmin(OPENID)) {
        return { success: false, error: '无权限' };
      }
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
