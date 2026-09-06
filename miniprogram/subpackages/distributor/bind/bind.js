'use strict';

const API = require('../../../utils/api');
const { toast } = require('../../../utils/util');

Page({
  data: { token: '', loading: false, error: '', activated: false, code: '' },

  onLoad(options) {
    this.setData({ token: String(options.token || '').trim() });
  },

  async activate() {
    if (this.data.loading) return;
    if (!this.data.token) {
      this.setData({ error: '邀请链接无效，请联系运营重新获取' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      let openId = wx.getStorageSync('openId');
      if (!openId) {
        const login = await API.login({ action: 'login' });
        openId = login && login.openId;
        if (openId) wx.setStorageSync('openId', openId);
      }
      const result = await API.claimAgentInvite(this.data.token);
      if (!result || !result.success) throw new Error((result && result.error) || '激活失败');
      this.setData({ activated: true, code: result.code || '', loading: false });
      toast('分销员身份已激活', 'success');
    } catch (err) {
      this.setData({ error: err.message || '激活失败', loading: false });
    }
  },

  enterDashboard() {
    wx.redirectTo({ url: '/subpackages/distributor/dashboard/dashboard' });
  }
});
