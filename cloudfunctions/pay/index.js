const cloud = require('wx-server-sdk');

// 云环境 ID（必须显式写死，cloud.DYNAMIC_CURRENT_ENV 在云支付中可能为空）
const ENV_ID = 'cloud1-d4gx1jxk675274501';

cloud.init({ env: ENV_ID });
const db = cloud.database();
const _ = db.command;

// 从 admin_config 读取佣金比例（默认 15%）
async function getCommissionRate() {
  try {
    const cfgRes = await db.collection('pay_config').doc('default').get().catch(() => null);
    if (cfgRes && cfgRes.data && typeof cfgRes.data.commissionRate === 'number') return cfgRes.data.commissionRate;
    const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    const cfg = (adminRes && adminRes.data) || {};
    return typeof cfg.commissionRate === 'number' ? cfg.commissionRate : 0.15;
  } catch (e) {
    return 0.15;
  }
}
// 真实云支付依赖「云环境绑定商户号」+ pay_config 中记录 subMchId。
// 切换规则（优先级从高到低）：
//   1) useMockPay === true  → 强制模拟支付（不收真实钱，用于开发/回滚）
//   2) useMockPay === false → 强制真实微信支付
//   3) 字段缺失：若已配置 subMchId（说明商户已绑定）→ 走真实支付；否则 → 模拟支付
async function resolveUseMockPay() {
  try {
    const cfgRes = await db.collection('pay_config').doc('default').get().catch(() => null);
    if (cfgRes && cfgRes.data) {
      if (cfgRes.data.useMockPay === true) return true;   // 显式强制 mock
      if (cfgRes.data.useMockPay === false) return false;  // 显式强制真实
      // 字段缺失：商户号已配置即视为已就绪，自动走真实支付
      if (cfgRes.data.subMchId) return false;
    }
  } catch (e) {}
  return true; // 兜底：未配置商户号时保持 mock
}

// 商户号配置
async function resolveSubMchId() {
  try {
    const cfgRes = await db.collection('pay_config').doc('default').get().catch(() => null);
    if (cfgRes && cfgRes.data && cfgRes.data.subMchId) return cfgRes.data.subMchId;
  } catch (e) {}
  return '';
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  switch (event.action) {
    case 'request': {
      const orderId = event.orderId;
      if (!orderId) {
        return { success: false, error: '订单号缺失' };
      }

      // 仅允许本人支付自己的订单
      const orderRes = await db.collection('orders').doc(orderId).get().catch(() => null);
      const order = orderRes && orderRes.data;
      if (!order) {
        return { success: false, error: '订单不存在' };
      }
      if (order.userId !== OPENID) {
        return { success: false, error: '无权操作此订单' };
      }
      if (order.status === 'paid' || order.status === 'shipped' || order.status === 'received') {
        return { success: true, mock: true, message: '订单已支付', orderId };
      }
      if (order.status !== 'pending') {
        return { success: false, error: '当前订单状态不可支付' };
      }

      // ===== 模拟支付模式（未开通商户号时使用）=====
      const useMock = await resolveUseMockPay();
      const subMchId = await resolveSubMchId();
      if (useMock || !subMchId) {
        // Mock 模式：mock 支付不会有真实的 payNotify 回调，必须在这里同步把订单落成 paid
        // 否则订单永远停在 pending，导致退款链路彻底跑不通。
        const mockTxnId = 'MOCK_TXN_' + order.orderNo;
        await db.collection('orders').doc(orderId).update({
          data: {
            status: 'paid',
            transactionId: mockTxnId,
            payTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        });
        // 模拟 payNotify 的佣金结算（与 payNotify 内的逻辑保持一致）
        if (order.agentId) {
          try {
            const rate = await getCommissionRate();
            const amount = Math.round(order.totalFee * rate);
            const existCheck = await db.collection('commissions')
              .where({ orderId: order._id })
              .count();
            if (existCheck.total === 0) {
              await db.collection('commissions').add({
                data: {
                  agentId: order.agentId,
                  orderId: order._id,
                  orderNo: order.orderNo,
                  amount: amount,
                  rate: rate,
                  status: 'settled',
                  settleTime: db.serverDate(),
                  createTime: db.serverDate(),
                  paidTime: null,
                  source: 'mockPay'
                }
              });
              await db.collection('orders').doc(orderId).update({
                data: { commissionStatus: 'settled' }
              });
            }
          } catch (commErr) {
            console.error('[mockPay] 佣金结算失败（不影响支付）:', commErr);
          }
        }
        return {
          success: true,
          mock: true,
          message: '模拟支付成功',
          orderId
        };
      }

      // ===== 真实微信支付（微信云开发云支付）=====
      try {
        // 调用微信云支付统一下单
        const payRes = await cloud.cloudPay.unifiedOrder({
          body: `橘与杏 - ${order.items.map(i => i.name).join(', ')}`,
          outTradeNo: order.orderNo,
          spbillCreateIp: '127.0.0.1',
          subMchId: subMchId,
          totalFee: order.totalFee,
          envId: ENV_ID,
          functionName: 'payNotify',
          nonceStr: generateNonceStr(),
          tradeType: 'JSAPI',
          openId: OPENID
        });

        console.log('云支付 unifiedOrder 完整返回:', JSON.stringify(payRes));

        if (payRes.returnCode !== 'SUCCESS' || payRes.resultCode !== 'SUCCESS') {
          console.error('统一下单失败:', JSON.stringify(payRes));
          const errMsg = payRes.errCodeDes || payRes.returnMsg || payRes.errCode || '未知错误';
          return { success: false, error: `下单失败(${errMsg})` };
        }

        // 微信云支付 unifiedOrder 返回的 payment 对象，包含前端直接需要的所有参数
        // 结构：{ timeStamp, nonceStr, package, signType, paySign }
        const paymentParams = payRes.payment;

        if (!paymentParams || !paymentParams.paySign) {
          console.error('云支付返回缺少 payment 参数:', JSON.stringify(payRes));
          // 尝试手动从 payRes 顶层拼装（兼容旧版云支付 SDK）
          const fallbackPayment = {
            timeStamp: payRes.timeStamp || String(Math.floor(Date.now() / 1000)),
            nonceStr: payRes.nonceStr || generateNonceStr(),
            package: payRes.package || `prepay_id=${payRes.prepayId}`,
            signType: payRes.signType || 'MD5',
            paySign: payRes.paySign
          };
          if (!fallbackPayment.paySign) {
            return { success: false, error: `支付参数不完整，请检查云支付配置 payRes: ${JSON.stringify(payRes)}` };
          }
          // 记录支付单号
          await db.collection('orders').doc(orderId).update({
            data: { prepayId: payRes.prepayId || '' }
          });
          return { success: true, payment: fallbackPayment, orderId };
        }

        // 记录支付单号
        await db.collection('orders').doc(orderId).update({
          data: {
            prepayId: payRes.prepayId || (paymentParams.package || '').replace('prepay_id=', '')
          }
        });

        // 直接把 payment 对象透传给前端
        return {
          success: true,
          payment: paymentParams,
          orderId
        };
      } catch (err) {
        console.error('云支付调用失败:', JSON.stringify(err));
        const errMsg = (err && err.message) || JSON.stringify(err);
        return { success: false, error: '支付服务异常: ' + errMsg };
      }
    }

    default:
      return { success: false, error: 'unknown action' };
  }
};

function generateNonceStr(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let str = '';
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}
