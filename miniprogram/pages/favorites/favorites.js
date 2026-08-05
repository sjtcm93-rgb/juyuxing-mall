const API = require('../../utils/api');

Page({
  data: {
    products: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: true,
    loadingMore: false,
    loadError: '',
    editMode: false
  },

  onShow() { this.refresh(); },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true });
    this.loadList(false).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.loadMore();
  },

  refresh() {
    if (this.data.products.length === 0) {
      this.setData({ loading: true, loadError: '' });
    }
    this.setData({ page: 1, hasMore: true });
    this.loadList(false);
  },

  async loadList(isLoadMore) {
    if (isLoadMore) this.setData({ loadingMore: true });
    if (!wx.getStorageSync('openId')) {
      this.setData({ loading: false, loadingMore: false, products: [], loadError: '' });
      return;
    }
    const res = await API.getFavoriteList({
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
        hasMore: !!res.hasMore
      });
    } else {
      this.setData({ loading: false, loadingMore: false, loadError: (res && res.error) || '加载失败' });
    }
  },

  async loadMore() {
    this.setData({ page: this.data.page + 1, loadingMore: true });
    await this.loadList(true);
  },

  onToggleEdit() {
    this.setData({ editMode: !this.data.editMode });
  },

  async onRemoveOne(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const res = await API.toggleFavorite(id);
    if (res && res.success) {
      wx.showToast({ title: '已移除', icon: 'none' });
      const products = this.data.products.filter(p => p._id !== id);
      this.setData({ products: products });
    }
  },

  async onClearAll() {
    const products = this.data.products || [];
    if (products.length === 0) return;
    wx.showModal({
      title: '提示',
      content: '确定全部取消收藏？',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '处理中...' });
        for (const p of products) {
          await API.toggleFavorite(p._id, { silent: true });
        }
        wx.hideLoading();
        this.setData({ products: [], editMode: false, hasMore: false });
        wx.showToast({ title: '已全部移除', icon: 'none' });
      }
    });
  },

  onGoodsClick(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    if (this.data.editMode) return;
    wx.navigateTo({ url: `/pages/product/product?id=${goods._id}` });
  },

  onGoHome() { wx.switchTab({ url: "/pages/index/index" }); },

  retry() {
    this.setData({ loading: true, loadError: '' });
    this.refresh();
  }
});
