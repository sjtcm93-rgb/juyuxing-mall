const { toast, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: {
    available: 0,
    pendingAmount: 0,
    pendingCount: 0,
    amount: 0,
    quickAmount: 0,
    name: '',
    account: '',
    submitting: false
  },

  onShow() {
    this.loadBalance();
  },

  async loadBalance() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'withdrawal',
        data: { action: 'info' }
      });
      if (res.result && res.result.success) {
        this.setData({
          available: res.result.available,
          pendingAmount: res.result.pendingAmount,
          pendingCount: res.result.pendingCount
        });
      }
    } catch (err) {
      console.error('load balance error:', err);
    }
  },

  onAmountInput(e) {
    const val = parseFloat(e.detail.value) || 0;
    this.setData({ amount: Math.round(val * 100), quickAmount: 0 });
  },

  setQuickAmount(e) {
    const val = e.currentTarget.dataset.amount;
    if (val === 'all') {
      this.setData({ 
        amount: this.data.available - this.data.pendingAmount,
        quickAmount: 'all'
      });
    } else {
      this.setData({ amount: parseInt(val), quickAmount: parseInt(val) });
    }
  },

  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onAccountInput(e) { this.setData({ account: e.detail.value }); },

  async submitWithdrawal() {
    const { amount, name, account } = this.data;
    if (amount < 1000) { toast('提现金额不能低于10元'); return; }
    if (!name) { toast('请输入收款人姓名'); return; }
    if (!account) { toast('请输入收款账号'); return; }

    this.setData({ submitting: true });
    showLoading('提交中...');
    try {
      const res = await wx.cloud.callFunction({
        name: 'withdrawal',
        data: { action: 'apply', amount, name, account }
      });
      hideLoading();
      if (res.result && res.result.success) {
        toast('提现申请已提交', 'success');
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        toast(res.result?.error || '提现申请失败');
        this.setData({ submitting: false });
      }
    } catch (err) {
      hideLoading();
      toast('提现申请失败，请重试');
      this.setData({ submitting: false });
    }
  }
});
