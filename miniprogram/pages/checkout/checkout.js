const API = require('../../utils/api');
const request = require('../../utils/request');
const { toast, generateOrderNo, decorateList, decorateItem } = require('../../utils/util');

Page({
  data: {
    items: [],
    totalPrice: 0,
    discountAmount: 0,
    finalPrice: 0,
    address: null,
    remark: '',
    submitting: false,
    fromCart: false,
    productId: '',
    selectedCoupon: null,
    availableCoupons: [],
    loadError: '',
    loading: true
  },

  onLoad(options) {
    if (options.fromCart === '1') {
      // 优先从临时 storage 读取（避免 URL 超长），兼容旧版 URL 传参
      let items = wx.getStorageSync('checkoutItems') || [];
      if (items.length === 0 && options.items) {
        try {
          items = JSON.parse(decodeURIComponent(options.items));
        } catch (e) {
          items = [];
        }
      }
      if (items.length === 0) {
        this.setData({ loading: false, loadError: '结算商品为空，请重新选择' });
        return;
      }
      this.setData({ fromCart: true, items: decorateList(items) });
      this.calcTotal();
      this.fetchItemsDetail(items);
    } else if (options.productId) {
      this.setData({ productId: options.productId });
      this.fetchProductDetail(options.productId, Number(options.quantity) || 1, options.specName || '');
    } else {
      this.setData({ loading: false, loadError: '订单参数缺失' });
    }
    this.loadDefaultAddress();
    this.loadAvailableCoupons();
  },

  async fetchProductDetail(productId, quantity, specName) {
    const res = await API.getProduct(productId);
    if (!res || !res.success || !res.data) {
      this.setData({ loading: false, loadError: '商品不存在或已下架' });
      return;
    }
    const p = res.data;
    const item = {
      productId: p._id,
      name: p.name,
      spec: specName || (p.specs && p.specs[0] && p.specs[0].name) || '',
      price: Number(p.price) || 0,
      quantity: quantity,
      image: (p.images && p.images[0]) || ''
    };
    this.setData({ items: decorateList([item]), loading: false });
    this.calcTotal();
  },

  async fetchItemsDetail(items) {
    // 校验每个商品最新价格/库存/上下架
    const fixed = [];
    let changed = false;
    for (const it of items) {
      try {
        const res = await API.getProduct(it.productId);
        if (res && res.success && res.data) {
          const p = res.data;
          if (p.status && p.status !== 'on') {
            changed = true;
            continue;
          }
          fixed.push({
            productId: p._id,
            name: p.name,
            spec: it.spec || (p.specs && p.specs[0] && p.specs[0].name) || '',
            price: Number(p.price) || 0,
            quantity: Math.min(Number(it.quantity) || 1, (p.specs && p.specs[0] && p.specs[0].stock) || 9999),
            image: (p.images && p.images[0]) || ''
          });
        } else {
          changed = true;
        }
      } catch (e) {
        fixed.push(it);
      }
    }
    if (fixed.length === 0) {
      this.setData({ loading: false, loadError: '所选商品已下架' });
      return;
    }
    if (changed) toast('部分商品已下架，已自动剔除');
    this.setData({ items: decorateList(fixed), loading: false });
    this.calcTotal();
  },

  async loadDefaultAddress() {
    const res = await API.getAddressList();
    const addrList = (res && res.data) || [];
    const def = addrList.find(a => a.isDefault) || addrList[0];
    if (def) this.setData({ address: def });
  },

  async loadAvailableCoupons() {
    const items = this.data.items || [];
    if (items.length === 0) return;
    const total = this.data.totalPrice;
    const res = await API.getAvailableCoupons({ total });
    if (res && res.success) {
      this.setData({ availableCoupons: res.data || [] });
    }
  },

  calcTotal() {
    const items = this.data.items || [];
    const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
    const discount = Number((this.data.selectedCoupon && this.data.selectedCoupon.discount) || 0);
    const finalPrice = Math.max(0, total - discount);
    this.setData({ totalPrice: total, totalPriceText: (total/100).toFixed(2), discountAmount: discount, discountAmountText: (discount/100).toFixed(2), finalPrice: finalPrice, finalPriceText: (finalPrice/100).toFixed(2) });
  },

  selectAddress() {
    wx.navigateTo({ url: '/pages/address/address?from=checkout&selectedId=' + (this.data.address && this.data.address._id || '') });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  pickCoupon() {
    const list = this.data.availableCoupons || [];
    if (list.length === 0) { toast('暂无可用优惠券'); return; }
    const selected = this.data.selectedCoupon;
    wx.showActionSheet({
      itemList: list.map(c => `${c.label}（减¥${(c.discount / 100).toFixed(2)}）`).concat(['不使用优惠券']),
      success: (res) => {
        if (res.tapIndex >= list.length) {
          this.setData({ selectedCoupon: null });
        } else {
          this.setData({ selectedCoupon: list[res.tapIndex] });
        }
        this.calcTotal();
      }
    });
  },

  async submitOrder() {
    if (this.data.submitting) return;
    if (!this.data.address) { toast('请选择收货地址'); return; }
    const items = this.data.items || [];
    if (items.length === 0) { toast('订单商品为空'); return; }

    this.setData({ submitting: true });
    const orderData = {
      orderNo: generateOrderNo(),
      items: items.map(it => ({
        productId: it.productId,
        name: it.name,
        spec: it.spec,
        image: it.image || '',
        quantity: it.quantity,
        price: it.price
      })),
      // 告诉服务端只移除这些已结算的商品（productId_spec 组合），保留购物车其余商品
      removeCartKeys: items.map(it => `${it.productId}_${it.spec || ''}`),
      totalFee: this.data.finalPrice,
      address: this.data.address,
      remark: this.data.remark,
      couponId: (this.data.selectedCoupon && this.data.selectedCoupon.userCouponId) || '',
      couponDiscount: this.data.discountAmount
    };
    const res = await API.createOrder(orderData);
    if (res && res.success && res.orderId) {
      // 标记优惠券已使用
      if (this.data.selectedCoupon && this.data.selectedCoupon.userCouponId) {
        API.useCoupon({ userCouponId: this.data.selectedCoupon.userCouponId, orderId: res.orderId }, { silent: true });
      }
      if (this.data.fromCart) {
        // 清理临时结算数据（云端购物车由 order 云函数按 removeCartKeys 精确清理）
        try { wx.removeStorageSync('checkoutItems'); } catch (e) {}
      }
      toast('下单成功', 'success');
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/order-detail/order-detail?id=' + res.orderId,
          fail: () => wx.navigateTo({ url: '/pages/order/order' })
        });
      }, 600);
    } else {
      toast((res && res.error) || '下单失败');
      this.setData({ submitting: false });
    }
  }
});
