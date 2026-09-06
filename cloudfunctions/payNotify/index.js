'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const confirmPayment = require('./payment-effects').createPaymentEffects(cloud, db);

exports.main = async (event) => {
  const outTradeNo = event.out_trade_no || event.outTradeNo || '';
  const transactionId = event.transaction_id || event.transactionId || '';
  const payerOpenId = event.openid || event.openId || '';
  const totalFeeValue = event.total_fee === undefined ? event.totalFee : event.total_fee;
  const totalFee = totalFeeValue === undefined || totalFeeValue === null || totalFeeValue === ''
    ? null
    : Number(totalFeeValue);
  const resultCode = event.result_code || event.resultCode || '';
  const returnCode = event.return_code || event.returnCode || '';

  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    return { errcode: 0, errmsg: '支付未成功，无需处理' };
  }
  if (!outTradeNo) return { errcode: 1, errmsg: '缺少商户订单号' };
  if (totalFee !== null && (!Number.isInteger(totalFee) || totalFee <= 0)) {
    return { errcode: 1, errmsg: '支付金额格式错误' };
  }

  try {
    const result = await confirmPayment({
      outTradeNo,
      transactionId,
      payerOpenId,
      totalFee,
      source: 'payNotify'
    });
    console.log('[payNotify] 支付副作用已确认:', result.orderId);
    return { errcode: 0, errmsg: 'success' };
  } catch (err) {
    console.error('[payNotify] 处理失败:', err);
    return { errcode: 1, errmsg: '处理异常，请重试' };
  }
};
