/**
 * payNotify — 微信云支付回调云函数
 *
 * 微信云支付成功后，平台会自动调用此函数通知支付结果。
 * 注意：此函数必须是独立云函数，不能作为其他云函数内部的 action。
 */
const cloud = require('wx-server-sdk');

const ENV_ID = 'cloud1-d4gx1jxk675274501';
cloud.init({ env: ENV_ID });
const db = cloud.database();
const _ = db.command;

// 从 admin_config 读取佣金比例（默认 15%）
async function getCommissionRate(db) {
  try {
    const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (adminRes && adminRes.data) || {};
    return typeof cfg.commissionRate === 'number' ? cfg.commissionRate : 0.15;
  } catch (e) {
    return 0.15;
  }
}

exports.main = async (event, context) => {
  console.log('[payNotify] 收到回调:', JSON.stringify(event));

  const { outTradeNo, transactionId, resultCode, returnCode } = event;

  // 支付失败：不处理，返回成功避免重试
  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    console.error('[payNotify] 支付失败回调:', event);
    return { errcode: 0, errmsg: '支付未成功，不处理' };
  }

  try {
    // 根据订单号查找订单
    const orderRes = await db.collection('orders')
      .where({ orderNo: outTradeNo })
      .limit(1)
      .get();

    if (!orderRes.data || orderRes.data.length === 0) {
      console.error('[payNotify] 订单不存在:', outTradeNo);
      return { errcode: 0, errmsg: '订单不存在' };
    }

    const order = orderRes.data[0];

    // 已经处理过了，直接返回成功（防止重复通知）
    if (order.status === 'paid' || order.status === 'shipped' || order.status === 'received') {
      console.log('[payNotify] 订单已处理过，忽略重复回调:', order._id);
      return { errcode: 0, errmsg: '订单已处理' };
    }

    // 更新订单状态为已支付
    await db.collection('orders').doc(order._id).update({
      data: {
        status: 'paid',
        transactionId: transactionId || '',
        payTime: db.serverDate()
      }
    });

    console.log('[payNotify] 订单支付成功:', order._id, transactionId);

    // 触发佣金结算（如果有代理关系）
    // 用户选择"支付即结算"：佣金直接写入 settled 状态，代理可立即申请提现
    if (order.agentId) {
      try {
        const rate = await getCommissionRate();
        const amount = Math.round(order.totalFee * rate);
        // 防重复：先查是否已有该订单的佣金记录
        const existCheck = await db.collection('commissions')
          .where({ orderId: order._id })
          .count();
        if (existCheck.total === 0) {
          await db.collection('commissions').add({
            data: {
              agentId: order.agentId,
              orderId: order._id,
              orderNo: order.orderNo || outTradeNo,
              amount: amount,
              rate: rate,
              status: 'settled',          // 支付即结算，直接可提现
              settleTime: db.serverDate(),
              createTime: db.serverDate(),
              paidTime: null,
              source: 'payNotify'
            }
          });
          // 同步更新订单上的佣金状态
          await db.collection('orders').doc(order._id).update({
            data: {
              commission: amount,
              commissionStatus: 'settled'
            }
          });
          console.log('[payNotify] 佣金已结算:', order.agentId, amount);
        } else {
          console.log('[payNotify] 佣金已存在，跳过重复结算');
        }
      } catch (commErr) {
        console.error('[payNotify] 佣金结算失败（不影响支付）:', commErr);
      }
    }

    // ===== 老带新奖励：被推荐人首单支付成功后，给推荐人发券 =====
    try {
      await issueReferralReward(order);
    } catch (refErr) {
      console.error('[payNotify] 老带新奖励发放失败（不影响支付）:', refErr);
    }

    return { errcode: 0, errmsg: 'success' };
  } catch (err) {
    console.error('[payNotify] 处理失败:', err);
    // 返回非 0 会导致微信重试，这里返回 0 避免死循环
    return { errcode: 0, errmsg: '处理异常' };
  }
};

// 发放老带新奖励券
async function issueReferralReward(order) {
  const userId = order.userId;
  const referrerId = order.agentId || '';
  if (!userId || !referrerId || userId === referrerId) return;

  // 只有被推荐人的首单才发放奖励
  const paidOrderCount = await db.collection('orders')
    .where({
      userId: userId,
      status: _.in(['paid', 'shipped', 'received'])
    })
    .count();
  if (!paidOrderCount || paidOrderCount.total !== 1) return;

  // 防重复发放
  const existEvent = await db.collection('referral_events')
    .where({ orderId: order._id, type: 'first_purchase_reward' })
    .count();
  if (existEvent.total > 0) return;

  // 确认奖励券存在且有效
  const couponRes = await db.collection('coupons').doc('referral_reward').get().catch(() => null);
  if (!couponRes || !couponRes.data || couponRes.data.status !== 'on') return;

  // 给推荐人发放优惠券
  await db.collection('user_coupons').add({
    data: {
      userId: referrerId,
      couponId: 'referral_reward',
      status: 'unused',
      source: 'referral',
      claimTime: db.serverDate(),
      useTime: null,
      orderId: null
    }
  });

  // 增加券已领取数量
  await db.collection('coupons').doc('referral_reward').update({
    data: { claimed: _.inc(1) }
  }).catch(() => null);

  // 记录事件
  await db.collection('referral_events').add({
    data: {
      type: 'first_purchase_reward',
      referrerId: referrerId,
      refereeId: userId,
      orderId: order._id,
      orderNo: order.orderNo || '',
      couponId: 'referral_reward',
      amount: couponRes.data.value || 0,
      createTime: db.serverDate()
    }
  });

  console.log('[payNotify] 老带新奖励已发放:', referrerId, order._id);
}
