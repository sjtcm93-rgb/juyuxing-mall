const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d4gx1jxk675274501' });
const db = cloud.database();
const _ = db.command;

// 默认分类种子（首次部署 / 集合为空时写入）
const DEFAULT_CATEGORIES = [
  { name: '本草养颜', icon: '🌸', parentId: '', sort: 1, status: 'on', hot: true },
  { name: '草本润养', icon: '🌿', parentId: '', sort: 2, status: 'on', hot: true },
  { name: '日常滋补', icon: '🍵', parentId: '', sort: 3, status: 'on', hot: true },
  { name: '中医外养', icon: '🌾', parentId: '', sort: 4, status: 'on', hot: false },
  { name: '时令本草', icon: '🍂', parentId: '', sort: 5, status: 'on', hot: false },
  { name: '香疗舒缓', icon: '🕯️', parentId: '', sort: 6, status: 'on', hot: false }
];

async function ensureSeed() {
  try {
    const res = await db.collection('categories').limit(1).get();
    if (res.data && res.data.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await db.collection('categories').add({
          data: Object.assign({ createTime: db.serverDate() }, c)
        });
      }
    }
  } catch (e) {
    // 集合尚未创建，第一次 add 会自动建表
    try {
      for (const c of DEFAULT_CATEGORIES) {
        await db.collection('categories').add({
          data: Object.assign({ createTime: db.serverDate() }, c)
        });
      }
    } catch (e2) {
      console.error('ensureSeed catch branch failed:', e2);
    }
  }
}

exports.main = async (event) => {
  const action = event.action || 'list';
  try { await ensureSeed(); } catch (e) { console.error('ensureSeed failed:', e); }

  try {
    switch (action) {
      case 'list': {
        const res = await db.collection('categories')
          .where({ status: _.neq('off') })
          .orderBy('sort', 'asc')
          .limit(100)
          .get()
          .catch(() => ({ data: [] }));
        return { success: true, data: res.data || [] };
      }

      case 'detail': {
        if (!event.id) return { success: false, error: '缺少分类 id' };
        const res = await db.collection('categories').doc(event.id).get().catch(() => null);
        if (!res || !res.data) return { success: false, error: '分类不存在' };
        return { success: true, data: res.data };
      }

      case 'products': {
        const categoryId = event.id;
        const keyword = (event.keyword || '').trim();
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
          .get()
          .catch(() => ({ data: [] }));

        return {
          success: true,
          data: res.data || [],
          total: countRes.total || 0,
          page: page,
          pageSize: pageSize,
          hasMore: res.data && res.data.length >= pageSize
        };
      }

      case 'hotKeywords': {
        try {
          const cfg = await db.collection('config').doc('hotKeywords').get().catch(() => null);
          if (cfg && cfg.data && Array.isArray(cfg.data.list)) {
            return { success: true, data: cfg.data.list };
          }
        } catch (e) {}
        return { success: true, data: ['小紫瓶', '草本润养', '本草茶', '退热凝胶', '香疗精油'] };
      }

      default:
        return { success: false, error: 'unknown action: ' + action };
    }
  } catch (err) {
    console.error('category main error:', err);
    return { success: true, data: [] };
  }
};
