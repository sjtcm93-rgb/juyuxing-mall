const API = require('../../utils/api');
const { formatTime, decorateList, getOrderStatusText } = require('../../utils/util');

Page({
  data: {
    orders: [],
    currentTab: 'all',
    loading: true,
    loadError: '',
    page: 1,
    hasMore: true,
    loadingMore: false,
    debugInfo: ''
  },

  onLoad(options) {
    console.log('[order] onLoad options:', options);
    if (options.status) {
      this.setData({ currentTab: options.status });
    }
  },

  onShow() {
    console.log('[order] onShow currentTab:', this.data.currentTab);
    this.setData({ page: 1, hasMore: true, loading: true, loadError: '', debugInfo: '加载中…' });
    this.loadOrders();
  },

  onPullDownRefresh() {
    console.log('[order] onPullDownRefresh');
    this.setData({ page: 1, hasMore: true, loading: true, debugInfo: '刷新中…' });
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    console.log('[order] onReachBottom');
    this.setData({ page: this.data.page + 1, loadingMore: true });
    this.loadOrders(null, true);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    console.log('[order] switchTab:', tab);
    if (tab === this.data.currentTab) return;
    this.setData({ currentTab: tab, page: 1, hasMore: true, orders: [], loading: true, loadError: '', debugInfo: '切换中…' });
    this.loadOrders(tab);
  },

  async loadOrders(status, isLoadMore) {
    const tab = status || this.data.currentTab;
    console.log('[order] loadOrders tab:', tab, 'page:', this.data.page, 'isLoadMore:', isLoadMore);

    if (isLoadMore) this.setData({ loadingMore: true });

    try {
      // 所有 tab 统一走 getOrderList，退款/售后用 status='refunding'
      // 不依赖 myRefunds 新接口，无需额外部署云函数
      const queryStatus = tab === 'all' ? '' : tab;
      const res = await API.getOrderList({ status: queryStatus, page: this.data.page, pageSize: 10 });
      console.log('[order] API res:', res);

      if (!res) {
        console.error('[order] API returned null');
        this.setData({ loading: false, loadingMore: false, loadError: '服务返回为空', debugInfo: '错误: res=null' });
        return;
      }

      if (!res.success) {
        console.error('[order] API failed:', res.error);
        this.setData({ loading: false, loadingMore: false, loadError: res.error || '加载失败', debugInfo: '错误: ' + (res.error || 'unknown') });
        return;
      }

      // 安全处理数据
      let rawData = res.data || [];
      if (!Array.isArray(rawData)) {
        console.error('[order] res.data is not array:', rawData);
        rawData = [];
      }

      const safeData = rawData.filter(o => o && typeof o === 'object');
      console.log('[order] safeData count:', safeData.length);

      const list = decorateList(isLoadMore ? this.data.orders.concat(safeData) : safeData)
        .map(o => {
          const items = Array.isArray(o.items) ? o.items : [];
          return Object.assign({}, o, {
            items: items.map(p => Object.assign({}, p, {
              itemPriceText: ((Number(p.price) || 0) * (Number(p.quantity) || 1) / 100).toFixed(2)
            })),
            statusText: getOrderStatusText(o.status),
            totalFeeText: (typeof o.totalFee === 'number' ? (o.totalFee / 100).toFixed(2) : '0.00')
          });
        });

      console.log('[order] processed list length:', list.length);

      this.setData({
        orders: list,
        loading: false,
        loadingMore: false,
        hasMore: (res.data || []).length >= 10,
        debugInfo: '已加载 ' + list.length + ' 条'
      });
    } catch (err) {
      console.error('[order] loadOrders error:', err);
      this.setData({
        loading: false,
        loadingMore: false,
        loadError: err.message || '加载异常',
        debugInfo: '异常: ' + (err.message || String(err))
      });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  payOrder(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  retry() {
    console.log('[order] retry');
    this.setData({ loading: true, loadError: '', debugInfo: '重试中…' });
    this.loadOrders();
  },

  goIndex() { wx.switchTab({ url: '/pages/index/index' }); }
});
