const API = require('../../utils/api');

const HISTORY_KEY = 'searchHistory';
const HISTORY_MAX = 10;

function readHistory() {
  try {
    const arr = wx.getStorageSync(HISTORY_KEY);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function writeHistory(list) {
  try { wx.setStorageSync(HISTORY_KEY, list); } catch (e) {}
}

Page({
  data: {
    keyword: '',
    focused: true,
    hotKeywords: [],
    history: [],
    suggest: [],
    showSuggest: false,
    showResult: false,
    products: [],
    sortBy: 'sales',
    sortOptions: [
      { key: 'sales', label: '综合' },
      { key: 'priceAsc', label: '价格↑' },
      { key: 'priceDesc', label: '价格↓' },
      { key: 'new', label: '新品' }
    ],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    loadingMore: false,
    loadError: ''
  },

  onLoad() {
    this.setData({ history: readHistory() });
    this.loadHot();
  },

  async loadHot() {
    const res = await API.getCategoryList({ silent: true }).catch(() => null);
    // 复用 category 的 hotKeywords action
    const hotRes = await wx.cloud
      ? wx.cloud.callFunction({ name: 'category', data: { action: 'hotKeywords' } })
      : Promise.resolve({ result: { success: false } });
    if (hotRes && hotRes.result && hotRes.result.success && Array.isArray(hotRes.result.data)) {
      this.setData({ hotKeywords: hotRes.result.data });
    } else if (res && res.success) {
      // 兜底：用分类名作为热搜
      this.setData({ hotKeywords: (res.data || []).slice(0, 6).map(c => c.name) });
    }
  },

  onInput(e) {
    const value = e.detail.value || '';
    this.setData({ keyword: value });
    if (!value.trim()) {
      this.setData({ suggest: [], showSuggest: false });
      return;
    }
    this.fetchSuggest(value);
  },

  onFocus() { this.setData({ focused: true }); },

  onBlur() {
    // 延迟收起，否则点不到联想条目
    setTimeout(() => {
      if (!this.data.showResult) {
        this.setData({ showSuggest: false });
      }
    }, 200);
  },

  onConfirm() {
    const kw = (this.data.keyword || '').trim();
    if (!kw) return;
    this.pushHistory(kw);
    this.runSearch(true);
  },

  onCancel() {
    this.setData({ keyword: '', suggest: [], showSuggest: false, showResult: false });
  },

  onClearInput() {
    this.setData({ keyword: '', suggest: [], showSuggest: false });
  },

  onTapHot(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    this.setData({ keyword: word });
    this.pushHistory(word);
    this.runSearch(true);
  },

  onTapHistory(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    this.setData({ keyword: word });
    this.runSearch(true);
  },

  onTapSuggest(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    this.setData({ keyword: word });
    this.pushHistory(word);
    this.runSearch(true);
  },

  onClearHistory() {
    writeHistory([]);
    this.setData({ history: [] });
  },

  onRemoveHistory(e) {
    const word = e.currentTarget.dataset.word;
    const list = this.data.history.filter(w => w !== word);
    writeHistory(list);
    this.setData({ history: list });
  },

  pushHistory(word) {
    let list = readHistory().filter(w => w !== word);
    list.unshift(word);
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    writeHistory(list);
    this.setData({ history: list });
  },

  fetchSuggest: function (q) {
    if (this._suggestTimer) clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(async () => {
      const res = await API.searchProducts({ keyword: q, pageSize: 5, page: 1 }, { silent: true });
      if (res && res.success) {
        this.setData({ suggest: res.data || [], showSuggest: true });
      }
    }, 250);
  },

  onChangeSort(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.sortBy) return;
    this.setData({ sortBy: key, products: [], page: 1, hasMore: true, showResult: true });
    this.runSearch(false);
  },

  onReachBottom() {
    if (!this.data.showResult || !this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.loadMore();
  },

  onPullDownRefresh() {
    if (!this.data.showResult) { wx.stopPullDownRefresh(); return; }
    this.setData({ page: 1, hasMore: true, loadingMore: false });
    this.runSearch(false).finally(() => wx.stopPullDownRefresh());
  },

  async runSearch(reset) {
    const kw = (this.data.keyword || '').trim();
    if (!kw) return;
    if (reset) {
      this.setData({
        products: [],
        page: 1,
        hasMore: true,
        loadingMore: false,
        showResult: true,
        showSuggest: false,
        loading: true,
        loadError: ''
      });
    } else if (this.data.products.length === 0) {
      this.setData({ loading: true, loadError: '' });
    }
    const res = await API.searchProducts({
      keyword: kw,
      sortBy: this.data.sortBy,
      page: this.data.page,
      pageSize: this.data.pageSize
    });
    if (res && res.success) {
      const list = res.data || [];
      const products = this.data.page === 1 ? list : this.data.products.concat(list);
      this.setData({
        products: products,
        loading: false,
        loadingMore: false,
        hasMore: !!res.hasMore
      });
    } else {
      this.setData({ loading: false, loadingMore: false, loadError: (res && res.error) || '搜索失败' });
    }
  },

  async loadMore() {
    this.setData({ page: this.data.page + 1, loadingMore: true });
    await this.runSearch(false);
  },

  onGoodsClick(e) {
    const goods = e.detail.goods;
    if (goods && goods._id) wx.navigateTo({ url: `/pages/product/product?id=${goods._id}` });
  },

  onGoodsAction(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    if (!wx.getStorageSync('openId')) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    wx.navigateTo({ url: `/pages/checkout/checkout?productId=${goods._id}&quantity=1` });
  },

  retry() {
    this.setData({ loading: true, loadError: '' });
    this.runSearch(false);
  }
});
