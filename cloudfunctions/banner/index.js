'use strict';

const cloud = require('wx-server-sdk');

cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();

function toPublicBanner(banner, resolvedImages = {}) {
  return {
    _id: banner._id,
    imageUrl: resolvedImages[banner.imageUrl] || banner.imageUrl || '',
    title: banner.title || '',
    linkUrl: banner.linkUrl || ''
  };
}

async function listActiveBanners() {
  // 全量读取后在服务端过滤/排序，避免依赖 banners 集合上尚未创建的
  // status+sort 复合索引（以及单字段 sort 索引）。banner 数量很少，
  // 全量读取不会带来可感知的性能问题。
  const res = await db.collection('banners')
    .limit(1000)
    .get();
  return {
    data: (res.data || [])
      .filter(banner => banner && banner.status === 'on')
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
      .slice(0, 20)
  };
}

async function resolveCloudImageUrls(banners) {
  const fileList = (banners || [])
    .map(banner => banner && banner.imageUrl)
    .filter(imageUrl => typeof imageUrl === 'string' && imageUrl.indexOf('cloud://') === 0);
  if (!fileList.length || typeof cloud.getTempFileURL !== 'function') return {};

  const res = await cloud.getTempFileURL({ fileList });
  const resolved = {};
  (res.fileList || []).forEach(file => {
    if (file.fileID && file.tempFileURL) resolved[file.fileID] = file.tempFileURL;
  });
  return resolved;
}

exports.main = async (event = {}) => {
  if (event.action !== 'list') {
    return { success: false, error: '请求无效' };
  }

  try {
    const res = await listActiveBanners();
    const resolvedImages = await resolveCloudImageUrls(res.data || []);
    return { success: true, data: (res.data || []).map(banner => toPublicBanner(banner, resolvedImages)) };
  } catch (err) {
    console.error('[banner] public list failed:', err && err.message ? err.message : 'unknown');
    return { success: false, error: 'Banner 暂不可用' };
  }
};
