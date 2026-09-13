'use strict';

const API = require('../../../utils/api');
const { toast } = require('../../../utils/util');

Page({
  data: { token: '', loading: false, error: '', activated: false, code: '', form: { name: '', phone: '', nickName: '' } },

  onLoad(options) {
    let token = String(options.token || '').trim();
    // 扫小程序码进入：scene 格式 "i=<token>"（见 adminQrAuth createInviteQrImage）
    if (!token && options.scene) {
      const params = decodeURIComponent(String(options.scene)).split('&').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > 0) result[part.slice(0, index)] = part.slice(index + 1);
        return result;
      }, {});
      if (params.i) token = String(params.i).trim();
    }
    this.setData({ token });
  },

  onNameInput(e) { this.setData({ 'form.name': String(e.detail.value || '').trim() }); },
  onPhoneInput(e) { this.setData({ 'form.phone': String(e.detail.value || '').trim() }); },
  onNickNameInput(e) { this.setData({ 'form.nickName': String(e.detail.value || '').trim() }); },

  validate() {
    const { name, phone } = this.data.form;
    if (!name || name.length < 2) return '请填写真实姓名（至少 2 个字）';
    if (!/^1\d{10}$/.test(phone)) return '请填写正确的 11 位手机号';
    return '';
  },

  async activate() {
    if (this.data.loading) return;
    if (!this.data.token) {
      this.setData({ error: '邀请链接无效，请联系运营重新获取' });
      return;
    }
    const error = this.validate();
    if (error) {
      this.setData({ error });
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
      const result = await API.claimAgentInvite(this.data.token, this.data.form);
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
