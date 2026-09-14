'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

function withTransaction(work) {
  return typeof db.runTransaction === 'function' ? db.runTransaction(work) : work(db);
}

function normalizeRequestId(value) {
  const requestId = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{12,64}$/.test(requestId)) return requestId;
  return crypto.randomBytes(16).toString('hex');
}

async function getBalance(database, agentId) {
  const [commissionRes, pendingRes, frozenRes] = await Promise.all([
    database.collection('commissions')
      .where({ agentId, status: 'settled' })
      .limit(1000)
      .get(),
    database.collection('withdrawals')
      .where({ agentId, status: _.in(['pending', 'processing']) })
      .limit(1000)
      .get(),
    database.collection('commissions')
      .where({ agentId, status: 'frozen' })
      .limit(1000)
      .get()
  ]);
  const ledgerBalance = (commissionRes.data || [])
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const pendingAmount = (pendingRes.data || [])
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const frozenAmount = (frozenRes.data || [])
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    ledgerBalance,
    pendingAmount,
    pendingCount: (pendingRes.data || []).length,
    frozenAmount,
    frozenCount: (frozenRes.data || []).length,
    available: Math.max(0, ledgerBalance - pendingAmount)
  };
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const OPENID = ctx.OPENID || '';
  if (!OPENID) return { success: false, error: '缺少可信微信身份，请从小程序重新登录' };
  const action = event.action || 'info';

  const userRes = await db.collection('users').doc(OPENID).get().catch(() => null);
  const user = userRes && userRes.data;
  if (!user || !user.isAgent || !user.agentInfo || user.agentInfo.status !== 'active') {
    return { success: false, error: '分销员身份未激活' };
  }

  switch (action) {
    case 'info': {
      const balance = await getBalance(db, OPENID);
      return { success: true, ...balance };
    }

    case 'apply': {
      const amount = Number(event.amount);
      const name = String(event.name || '').trim();
      const account = String(event.account || '').trim();
      const requestId = normalizeRequestId(event.requestId);
      const idempotencyKey = `withdrawal:${OPENID}:${requestId}`;

      if (!Number.isInteger(amount) || amount <= 0) {
        return { success: false, error: '提现金额无效' };
      }
      if (amount < 1000) {
        return { success: false, error: '最低提现金额为10元' };
      }
      if (!name || !account) {
        return { success: false, error: '请填写收款信息' };
      }
      if (name.length > 40 || account.length > 100) {
        return { success: false, error: '收款信息过长' };
      }

      try {
        const result = await withTransaction(async transaction => {
          const duplicateRes = await transaction.collection('withdrawals')
            .where({ idempotencyKey })
            .limit(1)
            .get();
          const duplicate = duplicateRes.data && duplicateRes.data[0];
          if (duplicate) {
            return { withdrawalId: duplicate._id, duplicate: true };
          }

          // 读写用户版本字段，使同一分销员的并发申请冲突后重新计算余额。
          const latestUserRes = await transaction.collection('users').doc(OPENID).get();
          if (!latestUserRes.data || !latestUserRes.data.isAgent) {
            throw new Error('分销员身份未激活');
          }
          const balance = await getBalance(transaction, OPENID);
          if ((balance.ledgerBalance - balance.pendingAmount) <= 0) {
            throw new Error('当前存在退款冲销，佣金余额恢复为正后方可提现');
          }
          if (amount > (balance.ledgerBalance - balance.pendingAmount)) {
            if (balance.frozenAmount > 0) {
              throw new Error('可提现余额不足：还有冻结中的佣金，买家确认收货后即可提现');
            }
            throw new Error('可提现余额不足');
          }

          const createRes = await transaction.collection('withdrawals').add({ data: {
            idempotencyKey,
            requestId,
            agentId: OPENID,
            amount,
            name,
            account,
            status: 'pending',
            createTime: db.serverDate(),
            processTime: null,
            remark: ''
          } });
          await transaction.collection('users').doc(OPENID).update({
            data: { withdrawalVersion: _.inc(1), updateTime: db.serverDate() }
          });
          return { withdrawalId: createRes._id, duplicate: false };
        });
        return {
          success: true,
          withdrawalId: result.withdrawalId,
          duplicate: result.duplicate
        };
      } catch (err) {
        return { success: false, error: (err && err.message) || '提现申请失败' };
      }
    }

    case 'list': {
      const pageSize = Math.min(Math.max(Number(event.pageSize) || 20, 1), 50);
      const page = Math.max(Number(event.page) || 1, 1);
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
