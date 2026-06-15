const API = require('../../utils/api');
const { toast } = require('../../utils/util');

// 默认产品数据（云函数部署前的备用数据）
const DEFAULT_PRODUCT = {
  _id: 'default',
  name: '小紫瓶',
  subtitle: '皮肤舒缓退热凝胶',
  price: 6900,
  originalPrice: 7800,
  specs: [{ name: '13.5g', stock: 999 }],
  images: [],
  sales: 0,
  rating: 5.0
};

Page({
  data: {
    product: DEFAULT_PRODUCT,
    loading: true
  },

  onLoad() {
    this.loadProduct();
    // 自动处理代理邀请参数
    this.handleReferrer();
  },

  onShow() {
    // 每次显示首页时静默刷新数据
    this.loadProductSilent();
  },

  async handleReferrer() {
    const ref = getApp().getReferrer();
    if (ref) {
      wx.setStorageSync('pendingReferrer', ref);
    }
  },

  async loadProduct() {
    this.setData({ loading: true });
    try {
      const res = await API.getProductList({ pageSize: 1 });
      if (res && res.data && res.data.length > 0) {
        this.setData({ product: res.data[0], loading: false });
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('加载商品失败:', err);
      this.setData({ loading: false });
    }
  },

  async loadProductSilent() {
    try {
      const res = await API.getProductList({ pageSize: 1 });
      if (res && res.data && res.data.length > 0) {
        this.setData({ product: res.data[0] });
      }
    } catch (err) {
      // 静默失败，保留当前数据
    }
  },

  goToProduct(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/product/product?id=${id}`
    });
  },

  buyNow(e) {
    const id = e.currentTarget.dataset.id;
    const openId = wx.getStorageSync('openId');
    if (!openId) {
      this.loginFirst(() => {
        wx.navigateTo({ url: `/pages/checkout/checkout?productId=${id}&quantity=1` });
      });
    } else {
      wx.navigateTo({ url: `/pages/checkout/checkout?productId=${id}&quantity=1` });
    }
  },

  async loginFirst(callback) {
    try {
      const ref = wx.getStorageSync('pendingReferrer') || getApp().getReferrer();
      const res = await API.login({ ref });
      if (res && res.openId) {
        wx.setStorageSync('openId', res.openId);
        getApp().globalData.openId = res.openId;
        wx.removeStorageSync('pendingReferrer');
        if (callback) callback();
      }
    } catch (err) {
      toast('登录失败，请重试');
    }
  },

  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 自然疗愈好物',
      path: `/pages/index/index?ref=${openId || ''}`,
      imageUrl: '../../images/share-banner.png'
    };
  }
});
