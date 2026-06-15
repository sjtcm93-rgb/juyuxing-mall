const API = require('../../utils/api');
const { toast } = require('../../utils/util');

// 默认商品数据（API 不可用时的降级方案）
const DEFAULT_PRODUCT = {
  _id: 'default',
  name: '小紫瓶',
  subtitle: '皮肤舒缓退热凝胶',
  price: 6900,
  originalPrice: 7800,
  sales: 0,
  specs: [{ name: '13.5g', stock: 999 }],
  images: [],
  description: '<p>小紫瓶皮肤舒缓退热凝胶，甄选天然草本精华，温和舒缓肌肤不适。</p><p>适用于日常肌肤护理，帮助缓解燥热、泛红等肌肤问题。</p><p>核心成分：紫草提取物、甘草酸二钾、透明质酸钠</p>'
};

Page({
  data: {
    product: DEFAULT_PRODUCT,
    selectedSpec: 0,
    quantity: 1,
    loadedFromServer: false
  },

  onLoad(options) {
    if (options.id) {
      this.loadProduct(options.id);
    }
  },

  async loadProduct(id) {
    try {
      const res = await API.getProduct(id);
      if (res && res.data) {
        this.setData({ 
          product: res.data,
          loadedFromServer: true
        });
      } else {
        // API 返回但无数据，标注入参 ID
        this.setData({
          'product._id': id
        });
      }
    } catch (err) {
      console.error('load product error, using default:', err);
      // 使用本地默认数据，但保留传入的 ID
      this.setData({
        'product._id': id
      });
    }
  },

  selectSpec(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ selectedSpec: idx, quantity: 1 });
  },

  decreaseQty() {
    if (this.data.quantity > 1) {
      this.setData({ quantity: this.data.quantity - 1 });
    }
  },

  increaseQty() {
    const maxStock = this.data.product.specs && 
      this.data.product.specs[this.data.selectedSpec]?.stock || 999;
    if (this.data.quantity < maxStock) {
      this.setData({ quantity: this.data.quantity + 1 });
    } else {
      toast('已达最大库存');
    }
  },

  async addToCart() {
    const openId = wx.getStorageSync('openId');
    if (!openId) {
      toast('请先登录');
      return;
    }
    try {
      await API.updateCart([{
        productId: this.data.product._id || 'default',
        name: this.data.product.name,
        spec: this.data.product.specs[this.data.selectedSpec]?.name || '13.5g',
        price: this.data.product.price,
        quantity: this.data.quantity,
        image: (this.data.product.images && this.data.product.images[0]) || ''
      }]);
      toast('已加入购物车', 'success');
    } catch (err) {
      toast('添加失败，请重试');
    }
  },

  buyNow() {
    const { product, quantity, selectedSpec } = this.data;
    const openId = wx.getStorageSync('openId');
    if (!openId) {
      toast('请先登录');
      return;
    }
    wx.navigateTo({
      url: `/pages/checkout/checkout?productId=${product._id || 'default'}&quantity=${quantity}&spec=${selectedSpec}`
    });
  },

  onShareAppMessage() {
    const product = this.data.product;
    const app = getApp();
    const ref = app.globalData.openId || wx.getStorageSync('openId');
    return {
      title: `${product.name} - ${product.subtitle}`,
      path: `/pages/product/product?id=${product._id || 'default'}&ref=${ref || ''}`,
      imageUrl: product.images && product.images[0]
    };
  }
});
