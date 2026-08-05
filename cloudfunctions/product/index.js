const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  try {
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
        .get()
        .catch(() => ({ data: [] }));
      return { success: true, data: res.data || [] };
    }
    case 'search': {
      const keyword = (event.keyword || '').trim();
      const categoryId = event.categoryId || '';
      const sortBy = event.sortBy || 'sales';
      const pageSize = Math.min(Number(event.pageSize) || 20, 50);
      const page = Math.max(Number(event.page) || 1, 1);

      const where = { status: 'on' };
      if (categoryId) where.categoryId = categoryId;
      if (keyword) {
        const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        where.name = db.RegExp({ regexp: safe, options: 'i' });
      }

      let orderBy = 'sales';
      let order = 'desc';
      if (sortBy === 'priceAsc') { orderBy = 'price'; order = 'asc'; }
      else if (sortBy === 'priceDesc') { orderBy = 'price'; order = 'desc'; }
      else if (sortBy === 'new') { orderBy = 'createTime'; order = 'desc'; }

      const query = db.collection('products').where(where);
      const countRes = await query.count().catch(() => ({ total: 0 }));
      const res = await query
        .orderBy(orderBy, order)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      return {
        success: true,
        data: res.data || [],
        total: countRes.total || 0,
        page: page,
        pageSize: pageSize,
        hasMore: res.data && res.data.length >= pageSize
      };
    }
    default:
      return { success: false, error: 'unknown action: ' + (event.action || '') };
    }
  } catch (err) {
    console.error('[product] 运行时错误:', err);
    return {
      success: false,
      error: (err && err.message) || '云函数执行失败',
      _action: event.action,
      _err: (err && err.stack) ? err.stack.substring(0, 500) : ''
    };
  }
};
