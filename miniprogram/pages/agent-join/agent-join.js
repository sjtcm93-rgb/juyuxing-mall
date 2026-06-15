const API = require('../../utils/api');
const { toast, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: {
    name: '',
    phone: '',
    wechat: '',
    reason: '',
    applied: false,
    submitting: false
  },
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onPhoneInput(e) { this.setData({ phone: e.detail.value }); },
  onWechatInput(e) { this.setData({ wechat: e.detail.value }); },
  onReasonInput(e) { this.setData({ reason: e.detail.value }); },
  async submitApply() {
    const { name, phone, wechat } = this.data;
    if (!name) { toast('请输入姓名'); return; }
    if (!phone) { toast('请输入手机号'); return; }
    if (!wechat) { toast('请输入微信号'); return; }
    this.setData({ submitting: true });
    showLoading('提交中...');
      try {
      const res = await API.applyAgent({ name, phone, wechat, reason: this.data.reason });
      hideLoading();
      if (res && res.success) {
        toast('申请已提交','success');
        this.setData({ applied: true, submitting: false });
      } else {
        toast((res && res.error) || '提交失败，请重试');
        this.setData({ submitting: false });
      }
    } catch (err) {
      hideLoading();
      toast('提交失败，请重试');
      this.setData({ submitting: false });
    }
  },
  onShareAppMessage() {
    return { title: '橘与杏中医生活 - 成为代理', path: '/pages/agent-join/agent-join' };
  }
});
