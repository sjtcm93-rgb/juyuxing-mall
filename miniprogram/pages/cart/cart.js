const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    cartItems: [],
    totalPrice: 0,
    loading: true
  },

  onShow() { 
    this.loadCart(); 
  },

  async loadCart() {
    this.setData({ loading: true });
    try {
      const res = await API.getCart();
      const items = (res && res.items) || [];
      this.setData({ cartItems: items, loading: false }); 
      this.calcTotal();
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  calcTotal() {
    const total = this.data.cartItems.reduce(
      (sum, item) => sum + (item.price || 6900) * item.quantity, 0
    );
    this.setData({ totalPrice: total });
  },

  async decreaseItemQty(e) {
    const idx = e.currentTarget.dataset.index;
    const items = [...this.data.cartItems];
    if (items[idx].quantity > 1) {
      items[idx].quantity -= 1;
    } else {
      items.splice(idx, 1);
    }
    this.setData({ cartItems: items });
    this.calcTotal();
    await this.syncCart(items);
  },

  async increaseItemQty(e) {
    const idx = e.currentTarget.dataset.index;
    const items = [...this.data.cartItems];
    items[idx].quantity += 1;
    this.setData({ cartItems: items });
    this.calcTotal();
    await this.syncCart(items);
  },

  async syncCart(items) {
    try {
      await API.updateCart(items.map(item => ({
        productId: item.productId,
        name: item.name,
        spec: item.spec,
        price: item.price,
        quantity: item.quantity,
        image: item.image
      })));
    } catch (err) {
      console.error('sync cart error:', err);
    }
  },

  goCheckout() {
    if (this.data.cartItems.length === 0) { toast('购物车是空的'); return; }
    const first = this.data.cartItems[0];
    wx.navigateTo({ 
      url: `/pages/checkout/checkout?productId=${first.productId || 'default'}&quantity=${first.quantity || 1}` 
    });
  }
});
