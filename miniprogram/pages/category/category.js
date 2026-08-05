const API = require('../../utils/api');

Page({
  data: {
    categories: [],
    activeId: '',
    activeName: '',
    products: [],
    sortBy: 'sales',
    sortOptions: [
      { key: 'sales', label: '综合' },
      { key: 'priceAsc', label: '价格↑' },
      { key: 'priceDesc', label: '价格↓' },
      { key: 'new', label: '新品' }
    ],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: true,
    loadingMore: false,
    loadError: ''
  },

  onLoad() { this.loadCategories(); },

  onShow() {
    if (this.data.activeId && this.data.products.length === 0 && !this.data.loading) {
      this.refreshProducts();
    }
  },

  async loadCategories() {
    const res = await API.getCategoryList({ silent: true });
    if (res && res.success && res.data && res.data.length > 0) {
      const first = res.data[0];
      this.setData({
        categories: res.data,
        activeId: first._id,
        activeName: first.name,
        loading: false,
        loadError: ''
      });
      this.refreshProducts();
    } else {
      this.setData({
        categories: [],
        products: [],
        loading: false,
        loadError: (res && res.error) || '分类加载失败，请重试'
      });
    }
  },

  onSelectCategory(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    if (!id || id === this.data.activeId) return;
    this.setData({ activeId: id, activeName: name, products: [], page: 1, hasMore: true });
    this.refreshProducts();
  },

  onChangeSort(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.sortBy) return;
    this.setData({ sortBy: key, products: [], page: 1, hasMore: true });
    this.refreshProducts();
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.loadMore();
  },

  refreshProducts() {
    this.setData({ page: 1, hasMore: true, loadingMore: false });
    this.loadProducts(false);
  },

  async loadProducts(isLoadMore) {
    if (isLoadMore) this.setData({ loadingMore: true });
    const res = await API.getCategoryProducts({
      id: this.data.activeId,
      sortBy: this.data.sortBy,
      page: isLoadMore ? this.data.page : 1,
      pageSize: this.data.pageSize
    });
    if (res && res.success) {
      const list = res.data || [];
      const products = isLoadMore ? this.data.products.concat(list) : list;
      this.setData({
        products: products,
        loading: false,
        loadingMore: false,
        hasMore: !!res.hasMore,
        page: isLoadMore ? this.data.page : (res.page || 1)
      });
    } else {
      this.setData({ loading: false, loadingMore: false, loadError: (res && res.error) || '加载失败' });
    }
  },

  async loadMore() {
    this.setData({ page: this.data.page + 1, loadingMore: true });
    await this.loadProducts(true);
  },

  onGoodsClick(e) {
    const goods = e.detail.goods;
    if (goods && goods._id) wx.navigateTo({ url: `/pages/product/product?id=${goods._id}` });
  },

  onGoodsAction(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    if (!wx.getStorageSync('openId')) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    wx.navigateTo({ url: `/pages/checkout/checkout?productId=${goods._id}&quantity=1` });
  },

  onGoHome() { wx.switchTab({ url: '/pages/index/index' }); },

  retry() {
    this.setData({ loading: true, loadError: '' });
    if (this.data.categories.length === 0) this.loadCategories();
    else this.refreshProducts();
  }
});
