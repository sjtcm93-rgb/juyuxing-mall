const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    brandChars: ['橘', '与', '杏'],
    products: [],
    banners: [],
    loading: true,
    loadError: '',
    page: 1,
    hasMore: true,
    loadingMore: false,
    _diag: ''  // 诊断信息（开发用）
  },

  onLoad() {
    console.log('[index] onLoad 开始加载...');
    const t0 = Date.now();
    
    // 分别加载，精确捕获每个的错误
    this._loadWithDiag('product', () => this.loadProducts());
    this._loadWithDiag('banner', () => this.loadBanners());
    this.handleReferrer();
    
    console.log('[index] onLoad 发起调用耗时:', Date.now() - t0, 'ms');
  },

  onShow() {
    if (this.data.products.length > 0) {
      this.loadBannersSilent();
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true, loadingMore: false });
    Promise.all([
      this.loadProducts(true),
      this.loadBanners()
    ]).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.hasMore || this.data.loadingMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1, loadingMore: true });
    this.loadProducts(false, true);
  },

  // ===== 诊断包装器：精确记录哪个调用失败、花了多久 =====
  async _loadWithDiag(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      console.log(`[index] ${name} ✅ 成功, 耗时 ${Date.now() - t0}ms`);
    } catch (err) {
      const msg = err && (err.errMsg || err.message || JSON.stringify(err).substring(0, 200));
      console.error(`[index] ${name} ❌ 失败 (${Date.now() - t0}ms):`, msg);
      console.error(`[index] ${name} 完整错误对象:`, err);
      this.setData({
        loadError: `${name}请求失败: ${msg}`,
        _diag: `${name}: ${msg} (${Date.now() - t0}ms)`
      });
    }
  },

  async loadBanners() {
    const res = await API.getBannerList().catch(err => {
      console.error('[index] getBannerList catch:', err.errMsg || err);
      throw err;  // 重新抛出，让 _loadWithDiag 捕获
    });
    if (res && res.success && res.data) {
      const activeBanners = (res.data || [])
        .filter(b => b.status === 'on')
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
      this.setData({ banners: activeBanners });
    }
  },

  loadBannersSilent() {
    this.loadBanners().catch(() => {});
  },

  onBannerTap(e) {
    const linkUrl = e.currentTarget.dataset.link;
    if (!linkUrl) return;
    if (linkUrl.indexOf('http') === 0) {
      wx.showModal({ title: '提示', content: '即将打开外链：' + linkUrl, showCancel: false });
      return;
    }
    if (linkUrl.indexOf('/pages/') === 0) {
      wx.navigateTo({ url: linkUrl });
    }
  },

  handleReferrer() {
    const ref = getApp().getReferrer();
    if (ref) wx.setStorageSync('pendingReferrer', ref);
  },

  async loadProducts(isPullDown = false, isLoadMore = false) {
    if (!isPullDown && !isLoadMore) this.setData({ loading: true, loadError: '' });
    if (isLoadMore) this.setData({ loadingMore: true });
    
    const page = isPullDown ? 1 : (isLoadMore ? this.data.page : 1);
    const res = await API.getProductList({ pageSize: 10, page }).catch(err => {
      console.error('[index] getProductList catch:', err.errMsg || err);
      throw err;
    });
    
    if (res && res.success && res.data) {
      const list = isLoadMore ? this.data.products.concat(res.data) : res.data;
      this.setData({
        products: list,
        loading: false,
        loadingMore: false,
        hasMore: res.data.length >= 10
      });
    } else {
      this.setData({ loading: false, loadingMore: false });
    }
  },

  onGoodsClick(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    wx.navigateTo({ url: `/pages/product/product?id=${goods._id}` });
  },

  onGoodsAction(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    if (!wx.getStorageSync('openId')) {
      toast('请先登录');
      return;
    }
    wx.navigateTo({ url: `/pages/checkout/checkout?productId=${goods._id}&quantity=1` });
  },

  goCategory() { wx.navigateTo({ url: '/pages/category/category' }); },
  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },
  goFavorites() { wx.navigateTo({ url: '/pages/favorites/favorites' }); },
  goCouponCenter() { wx.navigateTo({ url: '/pages/coupon-center/coupon-center' }); },

  retry() {
    this.setData({ loading: true, loadError: '', _diag: '' });
    this.loadProducts();
    this.loadBanners();
  },

  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 自然疗愈好物',
      path: `/pages/index/index?ref=${openId || ''}`,
      imageUrl: '/images/share-banner.png'
    };
  }
});
