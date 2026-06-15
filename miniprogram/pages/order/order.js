const API = require('../../utils/api');
const { formatTime, getOrderStatusText } = require('../../utils/util');

Page({
  data: {
    orders: [],
    currentTab: 'all',
    loading: true
  },
  onLoad(options) {
    if (options.status) {
      this.setData({ currentTab: options.status });
    }
  },
  onShow() { this.loadOrders(); },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab, loading: true });
    this.loadOrders(tab);
  },
  async loadOrders(status) {
    const tab = status || this.data.currentTab;
    try {
      const res = await API.getOrderList({ status: tab === 'all' ? '' : tab });
      this.setData({
        orders: (res && res.data) || [],
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },
  statusText(status) { return getOrderStatusText(status); },
  formatTime(t) { return formatTime(new Date(t)); },
  goDetail(e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` });
  }
});
