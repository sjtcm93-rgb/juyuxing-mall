'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { applyRefundEffects } = require('./refund-effects');
const ENV_ID = 'cloud1-d4gx1jxk675274501';
cloud.init({ env: ENV_ID });
const db = cloud.database();
const _ = db.command;
const LEASE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const ACTIVE = ['pending_auto', 'channel_processing', 'manual_review', 'processing'];

const field = (value, camel, snake) => value[camel] === undefined ? value[snake] : value[camel];
const refundNo = id => 'RF' + crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 30);
const errorText = err => String((err && (err.errMsg || err.message)) || err || '未知异常').slice(0, 200);

async function authorized() {
  // Never trust event.userInfo or a client-supplied OpenID.
  const openId = cloud.getWXContext().OPENID;
  if (!openId) return false;
  const result = await db.collection('admin_accounts')
    .where({ wechatOpenId: openId, status: 'active' }).limit(2).get();
  return result.data && result.data.length === 1 && ['owner', 'finance'].includes(result.data[0].role);
}

async function claim(id) {
  return db.runTransaction(async tx => {
    const rf = (await tx.collection('refunds').doc(id).get()).data;
    if (!rf || !ACTIVE.includes(rf.status)) return null;
    if (rf.status === 'processing' && Date.now() - new Date(rf.claimTime || 0).getTime() < LEASE_MS) return null;
    if (rf.status !== 'processing' && Date.now() - new Date(rf.processTime || 0).getTime() < CHECK_INTERVAL_MS) return null;
    const claimToken = crypto.randomBytes(16).toString('hex');
    // Existing leases and any previous attempt are query-only, even when the network outcome was lost.
    const submissionUncertain = !!rf.submissionUncertain || rf.status === 'processing';
    const queryOnly = rf.executionVersion !== 2 || submissionUncertain || rf.status === 'channel_processing' ||
      !!rf.submittedAt || !!rf.processAttempts || !!rf.refundId || !!rf.channelObserved;
    await tx.collection('refunds').doc(id).update({ data: {
      status: 'processing', claimToken, submissionUncertain, claimTime: db.serverDate(), processTime: db.serverDate()
    } });
    return { ...rf, claimToken, queryOnly };
  });
}

async function patchClaim(rf, data) {
  const result = await db.collection('refunds').where({
    _id: rf._id, status: 'processing', claimToken: rf.claimToken
  }).update({ data: { ...data, processTime: db.serverDate() } });
  return !!(result.stats && result.stats.updated);
}

async function manualReview(rf, reason) {
  await patchClaim(rf, { status: 'manual_review', lastProcessError: reason });
  return 'manualReview';
}

async function finish(rf, order, wechatRefundId, channel) {
  await db.runTransaction(async tx => {
    const latest = (await tx.collection('refunds').doc(rf._id).get()).data;
    if (!latest || latest.status !== 'processing' || latest.claimToken !== rf.claimToken) throw new Error('退款执行锁已失效');
    if (latest.type === 'return_refund' && latest.returnStatus !== 'received') throw new Error('退货尚未确认收货');
    await applyRefundEffects(tx, db, order, latest, latest.restock === true);
    await tx.collection('refunds').doc(rf._id).update({ data: {
      status: 'approved', refundId: wechatRefundId, refundChannel: channel,
      outRefundNo: rf.outRefundNo, channelStatus: 'SUCCESS', lastProcessError: '',
      refundTime: db.serverDate(), processTime: db.serverDate()
    } });
  });
  return 'completed';
}

function parseQuery(response, rf, order) {
  if (!response || typeof response !== 'object') throw new Error('退款查询返回为空');
  const rc = field(response, 'returnCode', 'return_code');
  const code = field(response, 'resultCode', 'result_code');
  if (rc === 'SUCCESS' && code === 'FAIL' && field(response, 'errCode', 'err_code') === 'REFUNDNOTEXIST') {
    return { status: 'NOT_FOUND' };
  }
  if (rc !== 'SUCCESS' || code !== 'SUCCESS') throw new Error('退款查询失败：' +
    String(field(response, 'errCodeDes', 'err_code_des') || field(response, 'returnMsg', 'return_msg') || '未知'));
  const tradeNo = field(response, 'outTradeNo', 'out_trade_no');
  if (tradeNo && tradeNo !== order.orderNo) throw new Error('退款查询订单号不匹配');
  const count = Number(field(response, 'refundCount', 'refund_count'));
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('退款查询条数无效');
  for (let i = 0; i < count; i++) {
    if (field(response, 'outRefundNo' + i, 'out_refund_no_' + i) !== rf.outRefundNo) continue;
    const amount = Number(field(response, 'refundFee' + i, 'refund_fee_' + i));
    if (amount !== order.totalFee) throw new Error('退款查询金额不匹配');
    const status = field(response, 'refundStatus' + i, 'refund_status_' + i);
    const id = String(field(response, 'refundId' + i, 'refund_id_' + i) || '');
    if (status === 'SUCCESS' && !id) throw new Error('缺少渠道退款凭据');
    if (!['SUCCESS', 'PROCESSING', 'REFUNDCLOSE', 'CHANGE'].includes(status)) throw new Error('未知退款状态');
    return { status, id };
  }
  throw new Error('退款查询单号不匹配');
}

async function processOne(rf) {
  const order = (await db.collection('orders').doc(rf.orderId).get()).data;
  if (!order) return manualReview(rf, '关联订单不存在');
  if (order.status === 'refunded') return manualReview(rf, '历史已退款记录需单独核对，不自动修复账本');
  if (order.status !== 'refunding' || (order.refundId && order.refundId !== rf._id)) return manualReview(rf, '订单售后状态不匹配');
  if (rf.type === 'return_refund' && rf.returnStatus !== 'received') return manualReview(rf, '退货尚未确认收货');
  if (!['refund_only', 'return_refund'].includes(rf.type)) return manualReview(rf, '售后类型无效');
  if (!Number.isSafeInteger(order.totalFee) || order.totalFee <= 0 ||
      (rf.approvedAmount !== undefined && rf.approvedAmount !== order.totalFee)) return manualReview(rf, '审批金额与订单金额不匹配');
  rf.outRefundNo = rf.outRefundNo || refundNo(rf._id);
  if (order.paymentSource === 'mockPay' || String(order.transactionId || '').startsWith('MOCK_TXN_')) {
    return finish(rf, order, '', 'mock');
  }
  if (!order.transactionId) return manualReview(rf, '订单缺少微信支付交易号');
  const config = (await db.collection('pay_config').doc('default').get()).data || {};
  const subMchId = String(rf.subMchId || config.subMchId || '').trim();
  if (!subMchId) return manualReview(rf, '微信支付商户号未配置');
  let state;
  try {
    state = parseQuery(await cloud.cloudPay.queryRefund({
      subMchId, outRefundNo: rf.outRefundNo, nonceStr: crypto.randomBytes(16).toString('hex')
    }), rf, order);
  } catch (err) {
    return manualReview(rf, errorText(err) + '；仅核对，不重复提交退款');
  }
  if (state.status !== 'NOT_FOUND') await patchClaim(rf, { channelObserved: true, channelStatus: state.status });
  if (state.status === 'SUCCESS') return finish(rf, order, state.id, 'wechat');
  if (state.status === 'PROCESSING') {
    await patchClaim(rf, { status: 'channel_processing', channelStatus: 'PROCESSING', lastProcessError: '' });
    return 'waiting';
  }
  if (state.status !== 'NOT_FOUND') return manualReview(rf, '渠道状态 ' + state.status + '，请核查商户平台');
  if (rf.queryOnly) return manualReview(rf, '此前已尝试或接管过退款，暂未查询到结果；禁止自动再次提交');

  // Persist uncertainty BEFORE the external mutation. A crash or timeout can only lead to query, never resubmission.
  if (!await patchClaim(rf, {
    submittedAt: db.serverDate(), outRefundNo: rf.outRefundNo,
    subMchId, approvedAmount: order.totalFee, processAttempts: _.inc(1)
  })) return 'waiting';
  try {
    const response = await cloud.cloudPay.refund({
      subMchId, outTradeNo: order.orderNo, outRefundNo: rf.outRefundNo,
      nonceStr: crypto.randomBytes(16).toString('hex'), totalFee: order.totalFee,
      refundFee: order.totalFee, envId: ENV_ID, functionName: 'refund-processor'
    });
    // Acceptance is NOT completion. Only a subsequent authoritative query may post effects.
    const accepted = response && field(response, 'returnCode', 'return_code') === 'SUCCESS' &&
      field(response, 'resultCode', 'result_code') === 'SUCCESS' && field(response, 'refundId', 'refund_id');
    await patchClaim(rf, {
      status: accepted ? 'channel_processing' : 'manual_review',
      channelStatus: accepted ? 'PROCESSING' : 'UNKNOWN',
      lastProcessError: accepted ? '' : '退款申请未确认受理；请先核对渠道结果，禁止重复提交'
    });
    return accepted ? 'waiting' : 'manualReview';
  } catch (err) {
    return manualReview(rf, errorText(err) + '；资金结果未知，请查询核对，禁止重复提交');
  }
}

exports.main = async (event = {}) => {
  // Notifications are not trusted to mutate a ledger; operator reconciliation queries the channel.
  if (event.action !== 'sweep') return { success: false, error: '请通过后台登录确认页执行退款核对' };
  try {
    if (!await authorized()) return { success: false, error: '仅已绑定微信的店主或财务可执行退款' };
    if (typeof db.runTransaction !== 'function') throw new Error('当前数据库不支持退款事务');
    // processTime is bumped on every attempt, so old/manual cases cannot starve the rest of the queue.
    const pending = await db.collection('refunds').where({ status: _.in(ACTIVE) })
      .orderBy('processTime', 'asc').limit(20).get();
    const counts = { processed: 0, completed: 0, waiting: 0, manualReview: 0 };
    for (const row of pending.data || []) {
      if (counts.processed >= 3) break;
      const rf = await claim(row._id);
      if (!rf) continue;
      counts.processed++;
      try { counts[await processOne(rf)]++; }
      catch (err) { await manualReview(rf, errorText(err)); counts.manualReview++; }
    }
    // No order numbers, customer data or channel errors leave this privileged worker response.
    return { success: true, ...counts };
  } catch (err) {
    console.error('[refund-processor]', errorText(err));
    return { success: false, error: '退款执行或核对失败，请检查部署、权限和云函数日志；请勿重复退款' };
  }
};
