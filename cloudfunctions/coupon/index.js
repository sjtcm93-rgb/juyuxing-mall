const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

const COL_COUPON = 'coupons';
const COL_USER_COUPON = 'user_coupons';

function now() { return Date.now(); }

async function ensureSeed() {
  try {
    const res = await db.collection(COL_COUPON).limit(1).get();
    if (res.data && res.data.length === 0) {
      const seed = [
        { name: '新人立减券', type: 'amount', value: 1000, minSpend: 5000, total: 999, claimed: 0, scope: 'all', startTime: 0, endTime: 9999999999999, status: 'on', thumbnail: '' },
        { name: '本草茶折扣券', type: 'percent', value: 10, minSpend: 3000, total: 200, claimed: 0, scope: 'all', startTime: 0, endTime: 9999999999999, status: 'on', thumbnail: '' },
        { name: '满减优惠', type: 'amount', value: 3000, minSpend: 10000, total: 50, claimed: 0, scope: 'all', startTime: 0, endTime: 9999999999999, status: 'on', thumbnail: '' }
      ];
      for (const c of seed) {
        await db.collection(COL_COUPON).add({ data: Object.assign({ createTime: db.serverDate() }, c) });
      }
    }

    // 确保邀请奖励券始终存在（老带新奖励用）
    const refExist = await db.collection(COL_COUPON).doc('referral_reward').get().catch(() => null);
    if (!refExist || !refExist.data) {
      await db.collection(COL_COUPON).doc('referral_reward').set({
        data: {
          name: '邀请好友奖励券',
          type: 'amount',
          value: 500,
          minSpend: 7800,
          total: 999999,
          claimed: 0,
          scope: 'all',
          startTime: 0,
          endTime: 9999999999999,
          status: 'on',
          thumbnail: '',
          source: 'referral',
          createTime: db.serverDate()
        }
      });
    }
  } catch (e) {}
}

function calcDiscount(coupon, amountFen) {
  if (!coupon || amountFen < (coupon.minSpend || 0)) return 0;
  if (coupon.type === 'amount') return Math.min(Number(coupon.value) || 0, amountFen);
  if (coupon.type === 'percent') {
    const v = Math.floor(amountFen * (Number(coupon.value) || 0) / 100);
    return Math.min(v, amountFen);
  }
  return 0;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'center';
  try { await ensureSeed(); } catch (e) {}

  switch (action) {
    case 'center': {
      // 领券中心：所有上架的券 + 当前用户的领取状态
      const res = await db.collection(COL_COUPON)
        .where({ status: _.neq('off') })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get();
      let myClaimedMap = {};
      if (OPENID) {
        const mine = await db.collection(COL_USER_COUPON)
          .where({ userId: OPENID })
          .limit(200)
          .get().catch(() => ({ data: [] }));
        (mine.data || []).forEach(uc => {
          myClaimedMap[uc.couponId] = (myClaimedMap[uc.couponId] || 0) + 1;
        });
      }
      const data = (res.data || []).map(c => Object.assign({}, c, {
        myClaimed: myClaimedMap[c._id] || 0
      }));
      return { success: true, data: data };
    }

    case 'claim': {
      if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
      const couponId = event.couponId;
      if (!couponId) return { success: false, error: '缺少 couponId' };
      const cRes = await db.collection(COL_COUPON).doc(couponId).get().catch(() => null);
      if (!cRes || !cRes.data) return { success: false, error: '优惠券不存在' };
      const coupon = cRes.data;
      if (coupon.status === 'off') return { success: false, error: '该券已下架' };
      if ((coupon.total || 0) > 0 && (coupon.claimed || 0) >= coupon.total) {
        return { success: false, error: '已被领完' };
      }
      await db.collection(COL_USER_COUPON).add({
        data: {
          userId: OPENID,
          couponId: couponId,
          status: 'unused',
          claimTime: db.serverDate(),
          useTime: null,
          orderId: null
        }
      });
      await db.collection(COL_COUPON).doc(couponId).update({
        data: { claimed: _.inc(1) }
      }).catch(() => null);
      return { success: true, message: '领取成功' };
    }

    case 'mine': {
      if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
      const status = event.status || 'all'; // all | unused | used | expired
      const where = { userId: OPENID };
      if (status !== 'all') where.status = status;
      const res = await db.collection(COL_USER_COUPON)
        .where(where)
        .orderBy('claimTime', 'desc')
        .limit(100)
        .get();
      const ids = (res.data || []).map(uc => uc.couponId).filter(Boolean);
      let couponMap = {};
      if (ids.length > 0) {
        const cRes = await db.collection(COL_COUPON)
          .where({ _id: _.in(ids) })
          .limit(100)
          .get().catch(() => null);
        if (cRes && cRes.data) {
          couponMap = cRes.data.reduce((acc, c) => { acc[c._id] = c; return acc; }, {});
        }
      }
      const data = (res.data || []).map(uc => Object.assign({}, uc, {
        coupon: couponMap[uc.couponId] || null
      })).filter(uc => uc.coupon);
      return { success: true, data: data };
    }

    case 'available': {
      if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
      const amountFen = Number(event.amount) || 0;
      const res = await db.collection(COL_USER_COUPON)
        .where({ userId: OPENID, status: 'unused' })
        .limit(100)
        .get();
      const ids = (res.data || []).map(uc => uc.couponId).filter(Boolean);
      let couponMap = {};
      if (ids.length > 0) {
        const cRes = await db.collection(COL_COUPON)
          .where({ _id: _.in(ids) })
          .limit(100)
          .get().catch(() => null);
        if (cRes && cRes.data) {
          couponMap = cRes.data.reduce((acc, c) => { acc[c._id] = c; return acc; }, {});
        }
      }
      const list = (res.data || []).map(uc => {
        const c = couponMap[uc.couponId];
        if (!c) return null;
        // 过期检查
        if (c.endTime && c.endTime < now()) return null;
        const discount = calcDiscount(c, amountFen);
        return {
          userCouponId: uc._id,
          coupon: c,
          available: discount > 0,
          discount: discount,
          discountYuan: (discount / 100).toFixed(2)
        };
      }).filter(Boolean);
      // 按优惠额排序
      list.sort((a, b) => b.discount - a.discount);
      return { success: true, data: list };
    }

    case 'calculate': {
      if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
      const userCouponId = event.userCouponId;
      const amountFen = Number(event.amount) || 0;
      if (!userCouponId) return { success: false, error: '缺少 userCouponId' };
      const ucRes = await db.collection(COL_USER_COUPON).doc(userCouponId).get().catch(() => null);
      if (!ucRes || !ucRes.data) return { success: false, error: '优惠券不存在' };
      if (ucRes.data.userId !== OPENID) return { success: false, error: '无权使用该券' };
      if (ucRes.data.status !== 'unused') return { success: false, error: '该券不可用' };
      const cRes = await db.collection(COL_COUPON).doc(ucRes.data.couponId).get().catch(() => null);
      if (!cRes || !cRes.data) return { success: false, error: '优惠券已失效' };
      const coupon = cRes.data;
      const discount = calcDiscount(coupon, amountFen);
      return {
        success: true,
        discount: discount,
        finalAmount: Math.max(0, amountFen - discount),
        coupon: coupon
      };
    }

    case 'use': {
      // 订单提交成功时调用，把券标记为已使用
      if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
      const userCouponId = event.userCouponId;
      const orderId = event.orderId;
      if (!userCouponId) return { success: false, error: '缺少 userCouponId' };
      const ucRes = await db.collection(COL_USER_COUPON).doc(userCouponId).get().catch(() => null);
      if (!ucRes || !ucRes.data) return { success: false, error: '券不存在' };
      if (ucRes.data.userId !== OPENID) return { success: false, error: '无权操作' };
      if (ucRes.data.status !== 'unused') return { success: false, error: '该券已使用或失效' };
      await db.collection(COL_USER_COUPON).doc(userCouponId).update({
        data: {
          status: 'used',
          useTime: db.serverDate(),
          orderId: orderId || null
        }
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'unknown action: ' + action };
  }
};
