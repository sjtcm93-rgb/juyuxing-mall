'use strict';

const API = require('../../../utils/api');

const ROLE_TEXT = {
  owner: '店主',
  operations: '运营',
  finance: '财务'
};

Page({
  data: {
    scene: '',
    publicId: '',
    loading: true,
    confirming: false,
    confirmed: false,
    error: '',
    selfOpenId: '',
    buildVersion: '1.0.6',
    account: null,
    roleText: ''
  },

  onLoad(options) {
    const scene = String(options.scene || '').trim();
    const publicId = String(options.publicId || '').trim();
    this.setData({ scene, publicId });
    this.inspect();
  },

  async inspect() {
    this.setData({ loading: true, error: '', selfOpenId: '' });
    try {
      const result = await API.inspectAdminQrLogin({
        scene: this.data.scene,
        publicId: this.data.publicId
      });
      if (!result || !result.success) {
        const error = (result && result.error) || '二维码不可用';
        const selfOpenId = String((result && result.selfOpenId) || '').trim();
        this.setData({ loading: false, error, selfOpenId });
        if (error === '当前微信未绑定后台账号' && !selfOpenId) await this.loadSelfOpenId();
        return;
      }
      this.setData({
        loading: false,
        publicId: result.publicId || this.data.publicId,
        account: result.account,
        roleText: ROLE_TEXT[result.account && result.account.role] || '后台账号'
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '二维码不可用' });
    }
  },

  async loadSelfOpenId() {
    let openId = String(wx.getStorageSync('openId') || '').trim();
    if (!openId) {
      try {
        const result = await API.login({ action: 'login' }, { silent: true });
        openId = String((result && result.openId) || '').trim();
        if (openId) wx.setStorageSync('openId', openId);
      } catch (err) {}
    }
    if (openId) this.setData({ selfOpenId: openId });
  },

  async copySelfOpenId() {
    if (!this.data.selfOpenId) await this.loadSelfOpenId();
    if (!this.data.selfOpenId) {
      wx.showToast({ title: '绑定标识获取失败，请重试', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.selfOpenId,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  async confirmLogin() {
    if (this.data.confirming || this.data.confirmed || !this.data.account) return;
    this.setData({ confirming: true, error: '' });
    try {
      const result = await API.confirmAdminQrLogin({
        scene: this.data.scene,
        publicId: this.data.publicId
      });
      if (!result || !result.success) throw new Error((result && result.error) || '确认失败');
      this.setData({ confirming: false, confirmed: true });
    } catch (err) {
      this.setData({ confirming: false, error: err.message || '确认失败' });
    }
  }
});
