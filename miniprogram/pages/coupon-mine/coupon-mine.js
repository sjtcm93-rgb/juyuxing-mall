const API = require('../../utils/api');

const TABS = [
  { key: 'unused', label: '未使用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' }
];

Page({
  data: {
    tabs: TABS,
    activeTab: 'unused',
    coupons: [],
    loading: true,
    loadError: ''
  },

  onShow() { this.load(); },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onChangeTab(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeTab) return;
    this.setData({ activeTab: key, loading: true });
    this.load();
  },

  async load() {
    this.setData({ loading: this.data.coupons.length === 0, loadError: '' });
    if (!wx.getStorageSync('openId')) {
      this.setData({ coupons: [], loading: false });
      return;
    }
    const res = await API.getMyCoupons({ status: this.data.activeTab });
    if (res && res.success) {
      this.setData({ coupons: res.data || [], loading: false });
    } else {
      this.setData({ loading: false, loadError: (res && res.error) || '加载失败' });
    }
  },

  retry() {
    this.setData({ loading: true, loadError: '' });
    this.load();
  }
});
