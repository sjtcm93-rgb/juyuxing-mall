const API = require('../../utils/api');
const { toast, generateOrderNo, showLoading, hideLoading } = require('../../utils/util');

const DEFAULT_PRODUCT = {
  _id: 'default',
  name: '小紫瓶',
  subtitle: '皮肤舒缓退热凝胶',
  price: 6900,
  specs: [{ name: '13.5g', stock: 999 }],
  images: []
};

Page({
  data: {
    items: [],
    totalPrice: 0,
    address: null,
    remark: '',
    submitting: false,
    productId: ''
  },

  onLoad(options) {
    if (options.productId) {
      this.setData({ productId: options.productId });
      const item = {
        productId: options.productId,
        name: '小紫瓶',
        spec: '13.5g',
        price: 6900,
        quantity: parseInt(options.quantity) || 1,
        image: ''
      };
      this.setData({
        items: [item],
        totalPrice: item.price * item.quantity
      });
      // 尝试从服务器加载真实产品数据
      this.loadProductData(options.productId);
    }
    this.loadDefaultAddress();
  },

  async loadProductData(productId) {
    try {
      const res = await API.getProduct(productId);
      if (res && res.data) {
        const prod = res.data;
        const specName = (prod.specs && prod.specs[0] && prod.specs[0].name) || '13.5g';
        const item = {
          productId: prod._id || productId,
          name: prod.name,
          spec: specName,
          price: prod.price,
          quantity: this.data.items[0] ? this.data.items[0].quantity : 1,
          image: (prod.images && prod.images[0]) || ''
        };
        this.setData({
          items: [item],
          totalPrice: item.price * item.quantity
        });
      }
    } catch (err) {
      console.log('使用默认商品数据');
    }
  },

  async loadDefaultAddress() {
    try {
      const res = await API.getAddressList();
      const addrList = (res && res.data) || [];
      const defaultAddr = addrList.find(a => a.isDefault) || addrList[0];
      if (defaultAddr) this.setData({ address: defaultAddr });
    } catch (err) {}
  },

  selectAddress() {
    wx.navigateTo({ url: '/pages/address/address?from=checkout' });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async submitOrder() {
    if (this.data.submitting) return;
    if (!this.data.address) { toast('请选择收货地址'); return; }

    this.setData({ submitting: true });
    showLoading('提交订单...');
    try {
      const orderData = {
        orderNo: generateOrderNo(),
        items: this.data.items.map(item => ({
          productId: item.productId,
          name: item.name,
          spec: item.spec,
          image: item.image || '',
          quantity: item.quantity,
          price: item.price
        })),
        totalFee: this.data.totalPrice,
        address: this.data.address,
        remark: this.data.remark
      };
      const res = await API.createOrder(orderData);
      hideLoading();
      if (res && res.orderId) {
        toast('下单成功', 'success');
        // 尝试支付
        this.requestPayment(res.orderId);
      } else {
        toast('下单失败');
        this.setData({ submitting: false });
      }
    } catch (err) {
      hideLoading();
      toast('下单失败，请重试');
      this.setData({ submitting: false });
    }
  },

  async requestPayment(orderId) {
    try {
      const payRes = await API.requestPayment(orderId);
      if (payRes && payRes.payment) {
        wx.requestPayment({
          ...payRes.payment,
          success: () => {
            toast('支付成功', 'success');
            wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${orderId}` });
          },
          fail: () => {
            wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${orderId}` });
          }
        });
      } else {
        // 模拟支付成功
        toast('支付成功(模拟)', 'success');
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/order-detail/order-detail?id=${orderId}` });
        }, 1000);
      }
    } catch (err) {
      toast('支付功能待开通');
      // order 是 tabBar 页，不能 redirectTo / navigateTo
      wx.switchTab({ url: '/pages/order/order' });
    }
  }
});
