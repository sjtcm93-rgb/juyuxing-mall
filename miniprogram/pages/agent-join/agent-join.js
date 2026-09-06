const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    name: '',
    phone: '',
    reason: '',
    submitting: false
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ name: userInfo.nickName || '' });
  },

  onInput(e) {
    const f = e.currentTarget.dataset.field;
    this.setData({ [f]: e.detail.value });
  },

  validate() {
    if (!this.data.name.trim()) { toast('请填写姓名'); return false; }
    if (!/^1\d{10}$/.test(this.data.phone)) { toast('请输入正确的手机号'); return false; }
    if (this.data.reason.trim().length < 5) { toast('请简单说明申请理由（至少5个字）'); return false; }
    return true;
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.validate()) return;
    this.setData({ submitting: true });
    const res = await API.applyAgent({
      name: this.data.name.trim(),
      phone: this.data.phone.trim(),
      reason: this.data.reason.trim()
    });
    this.setData({ submitting: false });
    if (res && res.success) {
      const openId = wx.getStorageSync('openId') || '';
      if (openId) wx.removeStorageSync('userAgentInfo_' + openId);
      toast('申请已提交，等待审核', 'success');
      setTimeout(() => wx.navigateBack(), 800);
    } else {
      toast((res && res.error) || '提交失败');
    }
  }
});
