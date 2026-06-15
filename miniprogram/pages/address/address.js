const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: { addresses: [] },
  onShow() { this.loadAddresses(); },
  async loadAddresses() {
    try {
      const res = await API.getAddressList();
      this.setData({ addresses: (res && res.data) || [] });
    } catch (err) { toast('加载地址失败'); }
  },
  selectAddr(e) {
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && prev.route === 'pages/checkout/checkout') {
      const addr = this.data.addresses.find(a => a._id === e.currentTarget.dataset.id);
      if (addr) prev.setData({ address: addr });
      wx.navigateBack();
    }
  },
  async setDefault(e) {
    const { id } = e.currentTarget.dataset;
    await API.updateAddress(id, { isDefault: true });
    this.loadAddresses();
  },
  editAddr(e) {
    wx.navigateTo({ url: `/pages/address-edit/address-edit?id=${e.currentTarget.dataset.id}` });
  },
  async deleteAddr(e) {
    wx.showModal({
      title:'提示', content:'确定删除该地址？',
      success: async (r) => {
        if (r.confirm) {
          await API.deleteAddress(e.currentTarget.dataset.id);
          toast('已删除');
          this.loadAddresses();
        }
      }
    });
  }
});
