const API = require('../../utils/api');
const request = require('../../utils/request');
const { toast, decorateItem, decorateList } = require('../../utils/util');

Page({
  data: {
    cartItems: [],
    selectedMap: {},
    allSelected: false,
    totalPrice: 0,
    selectedCount: 0,
    loading: true,
    loadError: ''
  },

  onShow() {
    this.loadCart();
  },

  onPullDownRefresh() {
    this.loadCart().then(() => wx.stopPullDownRefresh());
  },

  async loadCart() {
    this.setData({ loading: true, loadError: '' });
    const res = await API.getCart();
    if (res && res.success) {
      const items = res.items || [];
      // 默认全选
      const selectedMap = {};
      items.forEach(it => { selectedMap[it.productId + '_' + (it.spec || '')] = true; });
      this.setData({
        cartItems: decorateList(items),
        selectedMap: selectedMap,
        loading: false
      });
      this.recalcTotal();
    } else {
      this.setData({ loading: false, loadError: (res && res.error) || '加载失败' });
    }
  },

  recalcTotal() {
    const items = this.data.cartItems || [];
    const map = this.data.selectedMap || {};
    let total = 0, count = 0, selected = 0;
    items.forEach(it => {
      const key = it.productId + '_' + (it.spec || '');
      if (map[key]) {
        total += (Number(it.price) || 0) * (Number(it.quantity) || 1);
        count += Number(it.quantity) || 1;
        selected += 1;
      }
    });
    this.setData({
      totalPrice: total,
      totalPriceText: (total / 100).toFixed(2),
      selectedCount: count,
      selectedItemCount: selected,
      allSelected: items.length > 0 && selected === items.length
    });
  },

  async toggleItem(e) {
    const id = e.currentTarget.dataset.id;
    const spec = e.currentTarget.dataset.spec || '';
    const key = id + '_' + spec;
    const map = Object.assign({}, this.data.selectedMap);
    map[key] = !map[key];
    this.setData({ selectedMap: map });
    this.recalcTotal();
  },

  toggleAll() {
    const items = this.data.cartItems || [];
    const next = !this.data.allSelected;
    const map = {};
    if (next) items.forEach(it => { map[it.productId + '_' + (it.spec || '')] = true; });
    this.setData({ selectedMap: map });
    this.recalcTotal();
  },

  async changeQty(e) {
    const idx = e.currentTarget.dataset.index;
    const delta = Number(e.currentTarget.dataset.delta);
    const items = [...this.data.cartItems];
    if (!items[idx]) return;
    const next = (Number(items[idx].quantity) || 1) + delta;
    if (next < 1) {
      items.splice(idx, 1);
    } else {
      items[idx] = Object.assign({}, items[idx], { quantity: next });
    }
    this.setData({ cartItems: decorateList(items) });
    this.recalcTotal();
    await this.syncCart(items);
  },

  async deleteItem(e) {
    const idx = e.currentTarget.dataset.index;
    const items = [...this.data.cartItems];
    items.splice(idx, 1);
    this.setData({ cartItems: decorateList(items) });
    this.recalcTotal();
    await this.syncCart(items);
    toast('已删除', 'success');
  },

  async deleteSelected() {
    const items = this.data.cartItems || [];
    const map = this.data.selectedMap || {};
    const remaining = items.filter(it => !map[it.productId + '_' + (it.spec || '')]);
    if (remaining.length === items.length) { toast('请先选中要删除的商品'); return; }
    this.setData({ cartItems: decorateList(remaining) });
    this.recalcTotal();
    await this.syncCart(remaining);
    toast('已删除选中商品', 'success');
  },

  async syncCart(items) {
    try {
      await API.updateCart(items.map(it => ({
        productId: it.productId,
        name: it.name,
        spec: it.spec,
        price: it.price,
        quantity: it.quantity,
        image: it.image
      })));
    } catch (err) {}
  },

  goCheckout() {
    const items = this.data.cartItems || [];
    const map = this.data.selectedMap || {};
    const picked = items.filter(it => map[it.productId + '_' + (it.spec || '')]);
    if (picked.length === 0) { toast('请选择要结算的商品'); return; }
    // 用临时 storage 传递选中商品，避免 URL 参数过长导致数据丢失
    wx.setStorageSync('checkoutItems', picked);
    wx.navigateTo({ url: `/pages/checkout/checkout?fromCart=1` });
  },

  goIndex() { wx.switchTab({ url: '/pages/index/index' }); },

  retry() { this.loadCart(); },

  onEmptyAction() { this.goIndex(); }
});
