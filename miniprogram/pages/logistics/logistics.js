const API = require('../../utils/api');
const { toast, formatTime, decorateList } = require('../../utils/util');

Page({
  data: {
    order: null,
    tracking: [],
    loading: true,
    loadError: ''
  },

  onLoad(options) {
    if (options.orderId) this.loadOrder(options.orderId);
  },

  async loadOrder(id) {
    this.setData({ loading: true, loadError: '' });
    const res = await API.getOrderDetail(id);
    if (res && res.success && res.data) {
      const o = res.data;
      const tracking = (o.logistics && Array.isArray(o.logistics.traces)) ? o.logistics.traces : [];
      this.setData({ order: o, tracking: decorateList(tracking), loading: false });
    } else {
      this.setData({ loading: false, loadError: (res && res.error) || '暂无物流信息' });
    }
  },

  retry() {
    if (this.data.order && this.data.order._id) {
      this.loadOrder(this.data.order._id);
    }
  }
});
