const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 工具：确保 admin_config 文档存在
async function ensureAdminConfig() {
  const res = await db.collection('admin_config').doc('admin').get().catch(() => null);
  if (!res || !res.data) {
    await db.collection('admin_config').doc('admin').set({
      data: {
        openId: '',
        note: '替换 openId 为你的微信 openId 以获得管理后台权限'
      }
    });
    return true;
  }
  return false;
}

exports.main = async (event) => {
  const action = event.action || 'init';

  if (action === 'init') {
    // 先确保管理后台配置存在（不论商品是否已存在）
    const adminCreated = await ensureAdminConfig();

    // 再检查商品是否已存在
    const existing = await db.collection('products').get();
    if (existing.data.length > 0) {
      return {
        success: true,
        message: '数据库已有数据，跳过商品初始化',
        count: existing.data.length,
        adminCreated
      };
    }

    // 创建默认商品 - 小紫瓶
    const productRes = await db.collection('products').add({
      data: {
        name: '小紫瓶',
        subtitle: '皮肤舒缓退热凝胶',
        price: 6900,
        originalPrice: 7800,
        specs: [{ name: '13.5g', stock: 999 }],
        images: [],
        description: '<p>小紫瓶皮肤舒缓退热凝胶，甄选天然草本精华，温和舒缓肌肤不适。</p><p>适用于日常肌肤护理，帮助缓解燥热、泛红等肌肤问题。</p><p>核心成分：紫草提取物、甘草酸二钾、透明质酸钠</p><p>使用方法：取适量均匀涂抹于肌肤不适处，轻轻按摩至吸收。每日可使用2-3次。</p><p>注意事项：仅限外用，避免接触眼睛。如有不适请停止使用。</p>',
        status: 'on',
        sales: 0,
        createTime: db.serverDate()
      }
    });

    return {
      success: true,
      message: '初始化完成',
      productId: productRes._id,
      adminCreated
    };
  }

  if (action === 'check') {
    const products = await db.collection('products').get();
    const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    return {
      success: true,
      productCount: products.data.length,
      products: products.data.map(p => ({
        _id: p._id,
        name: p.name,
        price: p.price,
        status: p.status
      })),
      adminConfigured: !!(adminRes && adminRes.data),
      adminOpenIdSet: !!(adminRes && adminRes.data && adminRes.data.openId)
    };
  }

  return { success: false, error: 'unknown action' };
};
