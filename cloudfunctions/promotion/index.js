'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const REQUESTED_ENV_VERSION = String(process.env.MINIPROGRAM_ENV_VERSION || 'trial').trim();
const MINIPROGRAM_ENV_VERSION = ['develop', 'trial', 'release'].includes(REQUESTED_ENV_VERSION)
  ? REQUESTED_ENV_VERSION
  : 'trial';

function randomKey(length = 8) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

async function getActiveAgent(openId) {
  const res = await db.collection('users').doc(openId).get().catch(() => null);
  const user = res && res.data;
  if (user && user.isAgent && user.agentInfo && user.agentInfo.status === 'active') return user;
  return null;
}

function parseScene(scene) {
  return String(scene || '').split('&').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
    return result;
  }, {});
}

async function ensureTarget(agent, productId) {
  const normalizedProductId = String(productId || '').trim();
  if (normalizedProductId) {
    const productRes = await db.collection('products').doc(normalizedProductId).get().catch(() => null);
    if (!productRes || !productRes.data || productRes.data.status !== 'on') throw new Error('商品不存在或已下架');
  }
  const existing = await db.collection('promotion_targets').where({
    agentId: agent._id, productId: normalizedProductId
  }).limit(1).get();
  if (existing.data && existing.data[0]) return existing.data[0];
  const contentKey = randomKey(8);
  const data = {
    agentId: agent._id, referralCode: agent.referralCode,
    productId: normalizedProductId, contentKey, status: 'active',
    createTime: db.serverDate(), qrFileId: '', urlLink: '', urlLinkExpireTime: null
  };
  const result = await db.collection('promotion_targets').add({ data });
  return { _id: result._id, ...data };
}

async function ensureQrCode(target) {
  if (target.qrFileId && target.qrEnvVersion === MINIPROGRAM_ENV_VERSION) return target.qrFileId;
  if (!cloud.openapi || !cloud.openapi.wxacode || typeof cloud.uploadFile !== 'function') return '';
  const scene = `r=${target.referralCode}&t=${target.contentKey}`;
  if (scene.length > 32) throw new Error('推广场景参数过长');
  const code = await cloud.openapi.wxacode.getUnlimited({
    scene, page: 'pages/index/index', checkPath: false, envVersion: MINIPROGRAM_ENV_VERSION, width: 430
  });
  const upload = await cloud.uploadFile({
    cloudPath: `promotion/${target.agentId}/${MINIPROGRAM_ENV_VERSION}/${target.contentKey}.png`,
    fileContent: code.buffer
  });
  await db.collection('promotion_targets').doc(target._id).update({
    data: { qrFileId: upload.fileID, qrEnvVersion: MINIPROGRAM_ENV_VERSION, qrCreateTime: db.serverDate() }
  });
  return upload.fileID;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    if (event.action === 'resolve') {
      const params = parseScene(decodeURIComponent(String(event.scene || '')));
      if (!params.r || !params.t) return { success: false, error: '推广参数无效' };
      const targetRes = await db.collection('promotion_targets').where({
        referralCode: params.r.toUpperCase(), contentKey: params.t, status: 'active'
      }).limit(1).get();
      const target = targetRes.data && targetRes.data[0];
      if (!target) return { success: false, error: '推广内容已失效' };
      return { success: true, ref: target.referralCode, productId: target.productId || '' };
    }

    const agent = await getActiveAgent(OPENID);
    if (!agent) return { success: false, error: '分销员身份未激活' };

    if (event.action === 'asset') {
      const target = await ensureTarget(agent, event.productId);
      const qrFileId = await ensureQrCode(target);
      const sharePath = target.productId
        ? `/pages/product/product?id=${encodeURIComponent(target.productId)}&ref=${agent.referralCode}`
        : `/pages/index/index?ref=${agent.referralCode}`;
      return {
        success: true,
        data: {
          targetId: target._id, type: target.productId ? 'product' : 'home',
          productId: target.productId || '', referralCode: agent.referralCode,
          sharePath, qrFileId, qrReady: !!qrFileId,
          scene: `r=${agent.referralCode}&t=${target.contentKey}`
        }
      };
    }

    if (event.action === 'urlLink') {
      if (!cloud.openapi || !cloud.openapi.urllink) return { success: false, error: '当前环境不支持 URL Link' };
      const target = await ensureTarget(agent, event.productId);
      const path = target.productId ? 'pages/product/product' : 'pages/index/index';
      const query = target.productId
        ? `id=${encodeURIComponent(target.productId)}&ref=${agent.referralCode}`
        : `ref=${agent.referralCode}`;
      const response = await cloud.openapi.urllink.generate({
        path, query, envVersion: MINIPROGRAM_ENV_VERSION, isExpire: true, expireType: 1, expireInterval: 30
      });
      const expireTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.collection('promotion_targets').doc(target._id).update({
        data: { urlLink: response.urlLink, urlLinkExpireTime: expireTime, urlLinkCreateTime: db.serverDate() }
      });
      return { success: true, data: { urlLink: response.urlLink, expireTime } };
    }

    return { success: false, error: 'unknown action' };
  } catch (err) {
    console.error('[promotion] 运行时错误:', err);
    return { success: false, error: (err && err.message) || '推广素材生成失败' };
  }
};
