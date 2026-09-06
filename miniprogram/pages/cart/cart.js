const API = require('../../utils/api');
const { toast, decorateList } = require('../../utils/util');

const CART_CACHE_TTL = 30 * 1000;

function getCartCacheKey() {
  let openId = '';
  try { openId = wx.getStorageSync('openId') || ''; } catch (e) {}
  return 'cartCache_' + (openId || 'guest');
}

Page({
  data: {
    cartItems: [],
    selectedMap: {},
    allSelected: false,
    totalPrice: 0,
    selectedCount: 0,
    promotion: { enabled: false, rules: [] },
    promotionTip: '',
    promotionPct: 0,
    loading: true,
    loadError: ''
  },

  onShow() {
    this.loadPromotions();
    this.loadCart();
  },

  onPullDownRefresh() {
    Promise.all([this.loadCart({ force: true }), this.loadPromotions()]).then(() => wx.stopPullDownRefresh());
  },

  async loadPromotions() {
    try {
      const res = await API.getPromotions({ silent: true });
      if (res && res.success && res.data) {
        this.setData({ promotion: res.data || { enabled: false, rules: [] } });
        this.recalcTotal();
      }
    } catch (err) {}
  },

  computePromotion(total) {
    const promotion = this.data.promotion || {};
    if (!promotion.enabled) return { tip: '', pct: 0 };
    const rules = (promotion.rules || []).slice().sort((a, b) => a.threshold - b.threshold);
    if (rules.length === 0) return { tip: '', pct: 0 };
    let best = null, next = null;
    for (const r of rules) {
      if (total >= r.threshold) best = r;
      else if (!next) next = r;
    }
    if (best) {
      return { tip: `已享满${Math.round(best.threshold / 100)}减${Math.round(best.discount / 100)}优惠`, pct: 100 };
    }
    if (next) {
      const gap = next.threshold - total;
      return { tip: `再买 ¥${(gap / 100).toFixed(2)} 可减 ${Math.round(next.discount / 100)} 元`, pct: Math.min(100, Math.round(total / next.threshold * 100)) };
    }
    return { tip: '', pct: 0 };
  },

  readCartCache() {
    try {
      const cache = wx.getStorageSync(getCartCacheKey());
      if (!cache || !Array.isArray(cache.items)) return null;
      if (Date.now() - Number(cache.timestamp || 0) > CART_CACHE_TTL) return null;
      return cache.items;
    } catch (e) {
      return null;
    }
  },

  writeCartCache(items) {
    try {
      wx.setStorageSync(getCartCacheKey(), {
        timestamp: Date.now(),
        items: Array.isArray(items) ? items : []
      });
    } catch (e) {}
  },

  applyCartItems(items) {
    items = Array.isArray(items) ? items : [];
    const selectedMap = {};
    items.forEach(it => { selectedMap[it.productId + '_' + (it.spec || '')] = true; });
    this.setData({
      cartItems: decorateList(items),
      selectedMap: selectedMap,
      loading: false,
      loadError: ''
    });
    this.recalcTotal();
  },

  async loadCart(options) {
    options = options || {};
    const cachedItems = options.force ? null : this.readCartCache();
    if (cachedItems) {
      this.applyCartItems(cachedItems);
      return this.refreshCart({ silent: true });
    }
    return this.refreshCart({ silent: false });
  },

  async refreshCart(options) {
    options = options || {};
    if (!options.silent) this.setData({ loading: true, loadError: '' });
    const res = await API.getCart({ silent: !!options.silent });
    if (res && res.success) {
      const items = res.items || [];
      this.writeCartCache(items);
      this.applyCartItems(items);
    } else {
      if (!options.silent) {
        this.setData({ loading: false, loadError: (res && res.error) || '加载失败' });
      }
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
    const promo = this.computePromotion(total);
    this.setData({
      totalPrice: total,
      totalPriceText: (total / 100).toFixed(2),
      selectedCount: count,
      selectedItemCount: selected,
      promotionTip: promo.tip,
      promotionPct: promo.pct,
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
    const nextItems = decorateList(items);
    this.setData({ cartItems: nextItems });
    this.recalcTotal();
    this.writeCartCache(nextItems);
    await this.syncCart(items);
  },

  async deleteItem(e) {
    const idx = e.currentTarget.dataset.index;
    const items = [...this.data.cartItems];
    items.splice(idx, 1);
    const nextItems = decorateList(items);
    this.setData({ cartItems: nextItems });
    this.recalcTotal();
    this.writeCartCache(nextItems);
    await this.syncCart(items);
    toast('已删除', 'success');
  },

  async deleteSelected() {
    const items = this.data.cartItems || [];
    const map = this.data.selectedMap || {};
    const remaining = items.filter(it => !map[it.productId + '_' + (it.spec || '')]);
    if (remaining.length === items.length) { toast('请先选中要删除的商品'); return; }
    const nextItems = decorateList(remaining);
    this.setData({ cartItems: nextItems });
    this.recalcTotal();
    this.writeCartCache(nextItems);
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
