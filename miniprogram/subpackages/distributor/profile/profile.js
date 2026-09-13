'use strict';

const API = require('../../../utils/api');
const { toast } = require('../../../utils/util');

Page({
  data: { info: {}, userInfo: {}, editing: false, saving: false, form: { name: '', phone: '' }, error: '' },

  async onShow() {
    const info = await API.getAgentInfo({ silent: true });
    this.setData({ info: info || {}, userInfo: wx.getStorageSync('userInfo') || {} });
  },

  copyCode() {
    if (!this.data.info.code) return;
    wx.setClipboardData({ data: this.data.info.code });
  },

  startEdit() {
    this.setData({
      editing: true, error: '',
      form: { name: this.data.info.name || '', phone: this.data.info.phone || '' }
    });
  },

  cancelEdit() { this.setData({ editing: false, error: '' }); },

  onNameInput(e) { this.setData({ 'form.name': String(e.detail.value || '').trim() }); },
  onPhoneInput(e) { this.setData({ 'form.phone': String(e.detail.value || '').trim() }); },

  async saveProfile() {
    if (this.data.saving) return;
    const { name, phone } = this.data.form;
    if (!name || name.length < 2) { this.setData({ error: '请填写真实姓名（至少 2 个字）' }); return; }
    if (!/^1\d{10}$/.test(phone)) { this.setData({ error: '请填写正确的 11 位手机号' }); return; }
    this.setData({ saving: true, error: '' });
    try {
      const result = await API.updateAgentProfile({ profile: this.data.form });
      if (!result || !result.success) throw new Error((result && result.error) || '保存失败');
      this.setData({ editing: false, saving: false, 'info.name': name, 'info.phone': phone });
      toast('资料已更新', 'success');
    } catch (err) {
      this.setData({ error: err.message || '保存失败', saving: false });
    }
  }
});
