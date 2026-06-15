const { toast, formatTime, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: {
    tab: 'dashboard',
    stats: { totalOrders:0, paidOrders:0, shippedOrders:0, totalSales:0, pendingAgents:0, pendingWithdrawals:0 },
    orders: [],
    pendingAgents: [],
    pendingWithdrawals: [],
    shipTarget: '',
    company: '',
    trackingNo: ''
  },

  onLoad() {
    this.loadDashboard();
  },

  switchTab(e) {
    const tab = typeof e === 'string' ? e : e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'dashboard') this.loadDashboard();
    if (tab === 'orders') this.loadOrders();
    if (tab === 'agents') this.loadPendingAgents();
    if (tab === 'withdrawals') this.loadPendingWithdrawals();
  },

  async loadDashboard() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'dashboard' } });
      if (res.result?.success) this.setData({ stats: res.result.stats });
    } catch (err) { toast('加载数据失败'); }
  },

  async loadOrders() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'orderList', status: 'paid' } });
      if (res.result?.success) this.setData({ orders: res.result.data || [] });
    } catch (err) { toast('加载订单失败'); }
  },

  showShipForm(e) {
    this.setData({ shipTarget: e.currentTarget.dataset.orderId, company: '', trackingNo: '' });
  },

  cancelShip() {
    this.setData({ shipTarget: '', company: '', trackingNo: '' });
  },

  onCompanyInput(e) { this.setData({ company: e.detail.value }); },
  onTrackingInput(e) { this.setData({ trackingNo: e.detail.value }); },

  async confirmShip(e) {
    const { company, trackingNo } = this.data;
    if (!company || !trackingNo) { toast('请填写物流信息'); return; }
    showLoading('发货中...');
    try {
      await wx.cloud.callFunction({
        name: 'admin',
        data: { action: 'shipOrder', orderId: e.currentTarget.dataset.orderId, company, trackingNo }
      });
      hideLoading();
      toast('已发货', 'success');
      this.setData({ shipTarget: '' });
      this.loadOrders();
      this.loadDashboard();
    } catch (err) { hideLoading(); toast('发货失败'); }
  },

  async loadPendingAgents() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'agentList' } });
      if (res.result?.success) this.setData({ pendingAgents: res.result.data || [] });
    } catch (err) { toast('加载代理申请失败'); }
  },

  async approveAgent(e) {
    const { userId, approve } = e.currentTarget.dataset;
    showLoading(approve ? '通过中...' : '拒绝中...');
    try {
      await wx.cloud.callFunction({ name: 'admin', data: { action: 'approveAgent', userId, approve: !!approve } });
      hideLoading();
      toast(approve ? '已通过' : '已拒绝', 'success');
      this.loadPendingAgents();
      this.loadDashboard();
    } catch (err) { hideLoading(); toast('操作失败'); }
  },

  async loadPendingWithdrawals() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'withdrawalList' } });
      if (res.result?.success) this.setData({ pendingWithdrawals: res.result.data || [] });
    } catch (err) { toast('加载提现申请失败'); }
  },

  async processWithdrawal(e) {
    const { wdId, approve } = e.currentTarget.dataset;
    showLoading(approve ? '确认中...' : '拒绝中...');
    try {
      await wx.cloud.callFunction({
        name: 'admin',
        data: { action: 'processWithdrawal', withdrawalId: wdId, approve: !!approve }
      });
      hideLoading();
      toast(approve ? '打款确认' : '已拒绝', 'success');
      this.loadPendingWithdrawals();
      this.loadDashboard();
    } catch (err) { hideLoading(); toast('操作失败'); }
  },

  formatTime(t) { return t ? formatTime(new Date(t)) : ''; }
});
