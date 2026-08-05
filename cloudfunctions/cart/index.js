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
      
      // 从 products 集合获取最新商品信息来填充价格/图片
      const enrichedItems = await Promise.all(items.map(async (item) => {
        try {
          const prodRes = await db.collection('products').doc(item.productId).get();
          const prod = prodRes.data;
          if (prod) {
            return {
              ...item,
              name: prod.name || item.name,
              price: prod.price || item.price,
              image: (prod.images && prod.images[0]) || item.image || '',
              spec: item.spec || (prod.specs && prod.specs[0] && prod.specs[0].name) || ''
            };
          }
        } catch (e) {
          // 如果商品不存在于 products 集合，返回原始数据
        }
        return item;
      }));
      
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
