const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  switch (event.action) {
    case 'apply': {
      // 先看当前用户是否已申请 / 已是代理 / 已被拒绝
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => null);
      const user = userRes?.data;
      if (!user) {
        return { success: false, error: '请先登录后再申请' };
      }
      if (user.isAgent) {
        return { success: false, error: '你已经是代理了' };
      }
      const currentStatus = user.agentInfo && user.agentInfo.status;
      if (currentStatus === 'pending') {
        return { success: false, error: '申请审核中，请耐心等待' };
      }
      // rejected 可以再次申请，accepted / active 已是代理（上面已拦截）

      // 简易入参校验
      if (!event.name || !event.phone) {
        return { success: false, error: '请填写姓名和手机号' };
      }

      // 生成推广码：取 OPENID 末 6 位，避免重复
      const code = 'JY' + OPENID.substring(Math.max(0, OPENID.length - 6)).toUpperCase();
      await db.collection('users').doc(OPENID).update({
        data: {
          isAgent: false,
          agentInfo: {
            level: 'pending',
            code: code,
            name: event.name,
            phone: event.phone,
            wechat: event.wechat || '',
            reason: event.reason || '',
            applyTime: db.serverDate(),
            status: 'pending'
          }
        }
      });
      return { success: true, code: code };
    }
    case 'info': {
      const res = await db.collection('users').doc(OPENID).get();
      const user = res.data || {};
      return {
        success: true,
        isAgent: user.isAgent || false,
        level: user.agentInfo?.level || '',
        code: user.agentInfo?.code || '',
        status: user.agentInfo?.status || ''
      };
    }
    case 'performance': {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // 计算本月业绩（仅 paid+ 状态）
      const monthOrders = await db.collection('orders')
        .where({
          agentId: OPENID,
          status: _.in(['paid', 'shipped', 'received']),
          createTime: _.gte(monthStart)
        })
        .get();

      const monthSales = monthOrders.data.reduce((s, o) => s + (o.totalFee || 0), 0);

      // 佣金汇总：以 commissions 集合为准（避免按订单重算造成差异）
      const commRes = await db.collection('commissions')
        .where({ agentId: OPENID })
        .get();

      const totalCommission = commRes.data.reduce((s, c) => s + (c.amount || 0), 0);
      const settledComm = commRes.data
        .filter(c => c.status === 'settled')
        .reduce((s, c) => s + (c.amount || 0), 0);
      const pendingComm = commRes.data
        .filter(c => c.status === 'pending')
        .reduce((s, c) => s + (c.amount || 0), 0);

      return {
        success: true,
        totalCommission,
        available: settledComm,
        pending: pendingComm,
        monthSales,
        monthCommission: monthOrders.data.reduce((s, o) => {
          return s + (o.commission || 0);
        }, 0),
        monthOrders: monthOrders.data.length
      };
    }
    case 'team': {
      const res = await db.collection('users')
        .where({ referrer: OPENID })
        .count();
      return { success: true, total: res.total };
    }
    case 'commissions': {
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
