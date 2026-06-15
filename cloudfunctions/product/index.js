const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  switch (event.action) {
    case 'get': {
      const res = await db.collection('products').doc(event.id).get();
      return { success: true, data: res.data };
    }
    case 'list': {
      const pageSize = event.pageSize || 10;
      const page = event.page || 1;
      const res = await db.collection('products')
        .where({ status: 'on' })
        .orderBy('sales', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data };
    }
    default:
      return { success: false, error: 'unknown action' };
  }
};
