const API = require('../../utils/api');
const { toast, formatTime, decorateList, decorateYuanItem } = require('../../utils/util');

Page({
  data: {
    available: 0,
    pendingAmount: 0,
    pendingCount: 0,
    amount: '',
    name: '',
    account: '',
    records: [],
    submitting: false,
    loading: true
  },

  onShow() { this.loadData(); },

  async loadData() {
    this.setData({ loading: true });
    const [infoRes, listRes] = await Promise.all([
      API.getWithdrawalInfo({ silent: true }),
      API.getWithdrawalList({ pageSize: 20 }, { silent: true })
    ]);
    if (infoRes && infoRes.success) {
      this.setData(decorateYuanItem({
        available: (infoRes.available || 0) / 100,
        pendingAmount: (infoRes.pendingAmount || 0) / 100,
        pendingCount: infoRes.pendingCount || 0
      }));
    }
    this.setData({
      records: decorateList((listRes && listRes.data) || []),
      loading: false
    });
  },

  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onAccount(e) { this.setData({ account: e.detail.value }); },

  fullAmount() {
    this.setData({ amount: this.data.available.toFixed(2) });
  },

  async submit() {
    if (this.data.submitting) return;
    const amount = Number(this.data.amount);
    if (isNaN(amount) || amount <= 0) { toast('请输入有效金额'); return; }
    if (amount > this.data.available) { toast('可提现余额不足'); return; }
    if (!this.data.name.trim() || !this.data.account.trim()) { toast('请填写收款信息'); return; }

    this.setData({ submitting: true });
    const res = await API.applyWithdrawal({
      amount: Math.round(amount * 100),
      name: this.data.name.trim(),
      account: this.data.account.trim()
    });
    this.setData({ submitting: false });
    if (res && res.success) {
      toast('申请已提交，等待审核', 'success');
      this.setData({ amount: '' });
      this.loadData();
    } else {
      toast((res && res.error) || '提交失败');
    }
  }
});
