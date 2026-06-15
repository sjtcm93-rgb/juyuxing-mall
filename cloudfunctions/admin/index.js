const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'dashboard';

  // 验证管理员身份
  const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
  const adminOpenId = adminRes?.data?.openId || '';
  const isAdmin = OPENID === adminOpenId;

  if (!isAdmin) {
    return { success: false, error: '无管理员权限' };
  }

  switch (action) {

    case 'dashboard': {
      // 订单统计
      const totalOrders = await db.collection('orders').count();
      const paidOrders = await db.collection('orders')
        .where({ status: 'paid' }).count();
      const shippedOrders = await db.collection('orders')
        .where({ status: 'shipped' }).count();

      // 销售额统计
      const allOrders = await db.collection('orders')
        .where({ status: _.in(['paid', 'shipped', 'received']) })
        .get();
      const totalSales = allOrders.data.reduce((s, o) => s + (o.totalFee || 0), 0);

      // 待处理项
      const pendingAgents = await db.collection('users')
        .where({ 'agentInfo.status': 'pending' }).count();
      const pendingWithdrawals = await db.collection('withdrawals')
        .where({ status: 'pending' }).count();

      return {
        success: true,
        stats: {
          totalOrders: totalOrders.total,
          paidOrders: paidOrders.total,
          shippedOrders: shippedOrders.total,
          totalSales,
          pendingAgents: pendingAgents.total,
          pendingWithdrawals: pendingWithdrawals.total
        }
      };
    }

    case 'orderList': {
      const pageSize = event.pageSize || 50;
      const page = event.page || 1;
      const status = event.status || '';
      let query = {};
      if (status) query.status = status;
      const res = await db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data };
    }

    case 'shipOrder': {
      // 发货：更新订单状态 + 添加物流信息
      const { orderId, company, trackingNo } = event;
      if (!orderId || !company || !trackingNo) {
        return { success: false, error: '请填写完整的物流信息' };
      }
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'shipped',
          logistics: { company, trackingNo, status: '已发货' },
          shipTime: db.serverDate()
        }
      });
      return { success: true, message: '已标记为发货' };
    }

    case 'agentList': {
      const res = await db.collection('users')
        .where({ 'agentInfo.status': 'pending' })
        .get();
      return { success: true, data: res.data };
    }

    case 'approveAgent': {
      const { userId, approve } = event;
      if (approve) {
        await db.collection('users').doc(userId).update({
          data: {
            isAgent: true,
            'agentInfo.level': '初级代理',
            'agentInfo.status': 'active'
          }
        });
      } else {
        await db.collection('users').doc(userId).update({
          data: {
            isAgent: false,
            'agentInfo.status': 'rejected'
          }
        });
      }
      return { success: true };
    }

    case 'withdrawalList': {
      const res = await db.collection('withdrawals')
        .where({ status: 'pending' })
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data };
    }

    case 'processWithdrawal': {
      // 关键修复：通过审批时必须把对应的 settled 佣金标记为 paid，
      // 否则代理可以重复提现同一笔已结算佣金。
      const { withdrawalId, approve, remark } = event;
      const wdRes = await db.collection('withdrawals').doc(withdrawalId).get();
      const wd = wdRes.data;
      if (!wd) return { success: false, error: '提现记录不存在' };
      if (wd.status !== 'pending') return { success: false, error: '该提现申请已处理' };

      if (approve) {
        await db.collection('withdrawals').doc(withdrawalId).update({
          data: { status: 'approved', processTime: db.serverDate(), remark: remark || '' }
        });

        // 按 settleTime 正序消费 settled 佣金，超出部分做拆分。
        let remaining = wd.amount;
        const settledList = await db.collection('commissions')
          .where({ agentId: wd.agentId, status: 'settled' })
          .orderBy('settleTime', 'asc')
          .get();

        for (const c of settledList.data) {
          if (remaining <= 0) break;
          const consume = Math.min(c.amount, remaining);
          if (consume === c.amount) {
            await db.collection('commissions').doc(c._id).update({
              data: {
                status: 'paid',
                paidTime: db.serverDate(),
                paidByWithdrawal: withdrawalId
              }
            });
          } else {
            // 部分消耗：扣减当前条目，再新建一条 paid 记录作为本次发放
            await db.collection('commissions').doc(c._id).update({
              data: { amount: c.amount - consume }
            });
            await db.collection('commissions').add({
              data: {
                agentId: wd.agentId,
                orderId: c.orderId,
                orderNo: c.orderNo,
                amount: consume,
                rate: c.rate,
                status: 'paid',
                settleTime: c.settleTime,
                paidTime: db.serverDate(),
                paidByWithdrawal: withdrawalId,
                source: 'split-from-' + c._id
              }
            });
          }
          remaining -= consume;
        }
        // remaining > 0 表示 settled 不足（理论上 withdrawal.apply 已校验过）
        return { success: true, message: '已确认打款', consumed: wd.amount - remaining };
      } else {
        await db.collection('withdrawals').doc(withdrawalId).update({
          data: { status: 'rejected', processTime: db.serverDate(), remark: remark || '' }
        });
        // 拒绝时不消耗佣金，用户可重新申请
        return { success: true, message: '已拒绝' };
      }
    }

    default:
      return { success: false, error: 'unknown action' };
  }
};
