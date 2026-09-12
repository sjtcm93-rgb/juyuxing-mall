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
    processingRefunds: false,
    refundResult: '',
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

  async processRefundQueue() {
    if (this.data.processingRefunds || !this.data.account ||
        !['owner', 'finance'].includes(this.data.account.role)) return;
    const accepted = await new Promise(resolve => wx.showModal({
      title: '处理并核对退款',
      content: '将处理最多 3 笔后台已批准的退款，可能产生真实退款。已有提交记录只查询，不重复退款；渠道成功后同步账本。',
      confirmText: '确认处理',
      success: result => resolve(!!result.confirm), fail: () => resolve(false)
    }));
    if (!accepted) return;
    this.setData({ processingRefunds: true, refundResult: '' });
    try {
      const response = await wx.cloud.callFunction({ name: 'refund-processor', data: { action: 'sweep' } });
      const result = response && response.result;
      if (!result || !result.success) throw new Error((result && result.error) || '处理未完成');
      this.setData({ refundResult: result.processed
        ? `本次处理 ${result.processed} 笔：成功入账 ${result.completed} 笔，渠道处理中 ${result.waiting} 笔，待核查 ${result.manualReview} 笔。请刷新电脑后台查看；未完成项可在 30 秒后再次核对。`
        : '暂无可执行的退款，或仍在冷却/处理期间。已批准的退款可在 30 秒后再次核对。' });
    } catch (err) {
      this.setData({ refundResult: (err.message || '处理失败') + '；结果未知时不要重复退款，请先核对渠道。' });
    } finally {
      this.setData({ processingRefunds: false });
    }
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
