const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    id: '',
    name: '',
    phone: '',
    region: ['', '', ''],
    detail: '',
    isDefault: false,
    submitting: false
  },

  onLoad(options) {
    if (options.id) {
      wx.setNavigationBarTitle({ title: '编辑地址' });
      this.loadAddress(options.id);
    }
  },

  async loadAddress(id) {
    const res = await API.getAddressList({ silent: true });
    if (res && res.success) {
      const item = (res.data || []).find(a => a._id === id);
      if (item) {
        this.setData({
          id: item._id,
          name: item.name || '',
          phone: item.phone || '',
          region: Array.isArray(item.region) && item.region.length === 3 ? item.region : ['', '', ''],
          detail: item.detail || '',
          isDefault: !!item.isDefault
        });
      }
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onOpenRegion() { this.selectComponent("#regionPicker").show(); },

  onRegionChange(e) {
    this.setData({ region: e.detail.value });
  },

  toggleDefault() {
    this.setData({ isDefault: !this.data.isDefault });
  },

  validate() {
    if (!this.data.name.trim()) { toast('请输入收货人姓名'); return false; }
    if (!/^1\d{10}$/.test(this.data.phone)) { toast('请输入正确的手机号'); return false; }
    if (!this.data.region[0] || !this.data.region[1] || !this.data.region[2]) { toast('请选择省市区'); return false; }
    if (!this.data.detail.trim()) { toast('请输入详细地址'); return false; }
    return true;
  },

  async save() {
    if (this.data.submitting) return;
    if (!this.validate()) return;
    this.setData({ submitting: true });
    const payload = {
      name: this.data.name.trim(),
      phone: this.data.phone.trim(),
      region: this.data.region,
      detail: this.data.detail.trim(),
      isDefault: this.data.isDefault
    };
    let res;
    if (this.data.id) {
      res = await API.updateAddress(this.data.id, payload);
    } else {
      res = await API.addAddress(payload);
    }
    this.setData({ submitting: false });
    if (res && res.success) {
      toast('保存成功', 'success');
      setTimeout(() => wx.navigateBack(), 600);
    } else {
      toast((res && res.error) || '保存失败');
    }
  }
});
