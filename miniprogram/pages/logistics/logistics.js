const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: { order: null, loading: true },
  onLoad(options) {
    if (options.id) this.loadOrder(options.id);
    else this.setData({ loading: false });
  },
  async loadOrder(id) {
    try {
      const res = await API.getOrderDetail(id);
      this.setData({ order: res && res.data, loading: false });
    } catch (err) {
      this.setData({ loading: false });
      toast('加载物流信息失败');
    }
  }
});
