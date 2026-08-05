const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, code: 'NO_AUTH', error: '请先登录' };
  const action = event.action || 'list';

  switch (action) {
    case 'toggle': {
      const productId = event.productId;
      if (!productId) return { success: false, error: '缺少 productId' };
      const existed = await db.collection('favorites')
        .where({ userId: OPENID, productId: productId })
        .limit(1)
        .get();
      if (existed.data && existed.data.length > 0) {
        await db.collection('favorites').doc(existed.data[0]._id).remove();
        return { success: true, favorited: false, action: 'removed' };
      }
      await db.collection('favorites').add({
        data: {
          userId: OPENID,
          productId: productId,
          createTime: db.serverDate()
        }
      }).catch(() => null);
      return { success: true, favorited: true, action: 'added' };
    }

    case 'check': {
      const productId = event.productId;
      if (!productId) return { success: false, error: '缺少 productId' };
      const existed = await db.collection('favorites')
        .where({ userId: OPENID, productId: productId })
        .limit(1)
        .get();
      return { success: true, favorited: !!(existed.data && existed.data.length > 0) };
    }

    case 'list': {
      const pageSize = Math.min(Number(event.pageSize) || 20, 50);
      const page = Math.max(Number(event.page) || 1, 1);
      const countRes = await db.collection('favorites')
        .where({ userId: OPENID })
        .count()
        .catch(() => ({ total: 0 }));
      const res = await db.collection('favorites')
        .where({ userId: OPENID })
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      const ids = (res.data || []).map(f => f.productId).filter(Boolean);
      let productMap = {};
      if (ids.length > 0) {
        const prodRes = await db.collection('products')
          .where({ _id: _.in(ids) })
          .limit(50)
          .get().catch(() => null);
        if (prodRes && prodRes.data) {
          productMap = prodRes.data.reduce((acc, p) => {
            acc[p._id] = p;
            return acc;
          }, {});
        }
      }
      const list = (res.data || []).map(f => {
        const p = productMap[f.productId];
        return p ? Object.assign({}, p, { favoriteId: f._id, favoritedAt: f.createTime }) : null;
      }).filter(Boolean);

      return {
        success: true,
        data: list,
        total: countRes.total || 0,
        page: page,
        pageSize: pageSize,
        hasMore: res.data && res.data.length >= pageSize
      };
    }

    default:
      return { success: false, error: 'unknown action: ' + action };
  }
};
