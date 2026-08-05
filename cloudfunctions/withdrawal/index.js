const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'info';

  switch (action) {
    case 'info': {
      // 获取代理的可提现金额和提现记录
      const commRes = await db.collection('commissions')
        .where({ agentId: OPENID, status: 'settled' })
        .get();
      const available = commRes.data.reduce((s, c) => s + (c.amount || 0), 0);
      
      // 处理中的提现
      const pendingRes = await db.collection('withdrawals')
        .where({ agentId: OPENID, status: _.in(['pending', 'processing']) })
        .get();
      const pendingAmount = pendingRes.data.reduce((s, w) => s + (w.amount || 0), 0);
      
      return {
        success: true,
        available,
        pendingAmount,
        pendingCount: pendingRes.data.length
      };
    }

    case 'apply': {
      const { amount, name, account } = event;
      
      if (!amount || amount <= 0) {
        return { success: false, error: '提现金额无效' };
      }
      if (amount < 1000) { // 10元起提（以分为单位）
        return { success: false, error: '最低提现金额为10元' };
      }
      if (!name || !account) {
        return { success: false, error: '请填写收款信息' };
      }

      // 检查可用余额
      const commRes = await db.collection('commissions')
        .where({ agentId: OPENID, status: 'settled' })
        .get();
      const available = commRes.data.reduce((s, c) => s + (c.amount || 0), 0);
      
      // 扣除处理中的提现
      const pendingRes = await db.collection('withdrawals')
        .where({ agentId: OPENID, status: _.in(['pending', 'processing']) })
        .get();
      const frozenAmount = pendingRes.data.reduce((s, w) => s + (w.amount || 0), 0);
      
      if (amount > (available - frozenAmount)) {
        return { success: false, error: '可提现余额不足' };
      }

      // 创建提现申请
      await db.collection('withdrawals').add({
        data: {
          agentId: OPENID,
          amount: amount,
          name: name,
          account: account,
          status: 'pending',
          createTime: db.serverDate(),
          processTime: null,
          remark: ''
        }
      });

      return { success: true };
    }

    case 'list': {
      const pageSize = event.pageSize || 20;
      const page = event.page || 1;
      const res = await db.collection('withdrawals')
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
