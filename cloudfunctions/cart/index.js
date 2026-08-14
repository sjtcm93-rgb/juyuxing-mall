const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  
  switch (event.action) {
    case 'get': {
      const res = await db.collection('cart').where({ userId: OPENID }).get();
      if (res.data.length === 0 || !res.data[0].items || res.data[0].items.length === 0) {
        return { success: true, items: [] };
      }
      const cart = res.data[0];
      const items = cart.items || [];
      const productIds = Array.from(new Set(items.map(item => item.productId).filter(Boolean)));
      let productMap = {};
      
      // 从 products 集合获取最新商品信息来填充价格/图片
      try {
        if (productIds.length > 0) {
          const prodRes = await db.collection('products').where({
            _id: _.in(productIds)
          }).get();
          productMap = (prodRes.data || []).reduce((map, prod) => {
            map[prod._id] = prod;
            return map;
          }, {});
        }
      } catch (e) {
        // 如果商品批量查询失败，返回购物车快照数据
      }
      const enrichedItems = items.map((item) => {
        const prod = productMap[item.productId];
        if (!prod) return item;
        return {
          ...item,
          name: prod.name || item.name,
          price: prod.price || item.price,
          image: (prod.images && prod.images[0]) || item.image || '',
          spec: item.spec || (prod.specs && prod.specs[0] && prod.specs[0].name) || ''
        };
      });
      
      return { success: true, items: enrichedItems };
    }
    case 'update': {
      const items = event.items || [];
      const existing = await db.collection('cart').where({ userId: OPENID }).get();
      if (existing.data.length > 0) {
        await db.collection('cart').doc(existing.data[0]._id).update({
          data: { items, updateTime: db.serverDate() }
        });
      } else {
        await db.collection('cart').add({
          data: { userId: OPENID, items, updateTime: db.serverDate() }
        });
      }
      return { success: true };
    }
    case 'clear': {
      const existing = await db.collection('cart').where({ userId: OPENID }).get();
      if (existing.data.length > 0) {
        await db.collection('cart').doc(existing.data[0]._id).update({
          data: { items: [], updateTime: db.serverDate() }
        });
      }
      return { success: true };
    }
    default:
      return { success: false, error: 'unknown action' };
  }
};
