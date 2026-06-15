const API = require('../../utils/api');
const { toast, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: {
    addressId: '',
    name: '',
    phone: '',
    region: [],
    regionText: '请选择省/市/区',
    detail: '',
    isDefault: false
  },
  onLoad(options) {
    if (options.id) {
      this.setData({ addressId: options.id });
      this.loadAddress(options.id);
    }
  },
  async loadAddress(id) {
    try {
      const res = await API.getAddressList();
      const addr = (res.data || []).find(a => a._id === id);
      if (addr) {
        this.setData({
          name: addr.name, phone: addr.phone,
          region: addr.region || [],
          regionText: addr.region ? addr.region.join(' ') : '请选择省/市/区',
          detail: addr.detail, isDefault: addr.isDefault
        });
      }
    } catch (err) { toast('加载地址失败'); }
  },
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onPhoneInput(e) { this.setData({ phone: e.detail.value }); },
  onRegionChange(e) {
    const val = e.detail.value;
    this.setData({ region: val, regionText: val.join(' ') });
  },
  onDetailInput(e) { this.setData({ detail: e.detail.value }); },
  onDefaultChange(e) { this.setData({ isDefault: e.detail.value }); },
  async saveAddress() {
    const { name, phone, region, detail } = this.data;
    if (!name) { toast('请输入收货人'); return; }
    if (!phone) { toast('请输入手机号'); return; }
    if (!region.length) { toast('请选择所在地区'); return; }
    if (!detail) { toast('请输入详细地址'); return; }
    showLoading('保存中...');
    try {
      const data = { name, phone, region, detail, isDefault: this.data.isDefault };
      if (this.data.addressId) {
        await API.updateAddress(this.data.addressId, data);
      } else {
        await API.addAddress(data);
      }
      hideLoading();
      toast('保存成功','success');
      wx.navigateBack();
    } catch (err) {
      hideLoading();
      toast('保存失败');
    }
  }
});
