const API = require('../../utils/api');
const { toast, formatTime, getOrderStatusText, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: { 
    order: { items: [] } 
  },

  onLoad(options) {
    if (options.id) this.loadOrder(options.id);
  },

  async loadOrder(id) {
    try {
      const res = await API.getOrderDetail(id);
      if (res && res.data) this.setData({ order: res.data });
    } catch (err) { 
      toast('加载订单失败'); 
    }
  },

  statusText(s) { 
    return getOrderStatusText(s); 
  },

  statusDesc(s) {
    const d = { 
      pending: '请尽快完成支付', 
      paid: '等待商家发货', 
      shipped: '商品正在路上', 
      received: '感谢您的购买' 
    };
    return d[s] || '';
  },

  formatTime(t) { 
    return t ? formatTime(new Date(t)) : ''; 
  },

  async payOrder() {
    showLoading('处理支付...');
    try {
      const res = await API.requestPayment(this.data.order._id);
      hideLoading();
      
      if (res && res.mock) {
        // 模拟支付成功（商户号开通前）
        toast('支付成功', 'success');
        this.loadOrder(this.data.order._id);
      } else if (res && res.payment) {
        // 真实微信支付
        wx.requestPayment({
          ...res.payment,
          success: () => {
            toast('支付成功', 'success');
            this.loadOrder(this.data.order._id);
          },
          fail: (err) => {
            toast('支付取消或失败');
          }
        });
      } else {
        toast('支付服务暂不可用');
      }
    } catch (err) {
      hideLoading();
      toast('支付失败，请重试');
    }
  },

  async cancelOrder() {
    wx.showModal({
      title: '提示',
      content: '确定取消该订单？',
      success: async (r) => {
        if (r.confirm) {
          await API.cancelOrder(this.data.order._id);
          toast('已取消');
          this.loadOrder(this.data.order._id);
        }
      }
    });
  },

  async confirmReceive() {
    showLoading('确认中...');
    await API.updateOrderStatus(this.data.order._id, 'received');
    hideLoading();
    toast('已确认收货', 'success');
    this.loadOrder(this.data.order._id);
  },

  contactService() { 
    wx.showToast({ title: '客服热线: 400-000-0000', icon: 'none' }); 
  },

  onShareAppMessage() {
    return {
      title: `订单 - ${this.data.order.orderNo || ''}`,
      path: `/pages/order-detail/order-detail?id=${this.data.order._id || ''}`
    };
  }
});
