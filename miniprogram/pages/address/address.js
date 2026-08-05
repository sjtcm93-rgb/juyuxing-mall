const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    addresses: [],
    loading: true,
    loadError: '',
    from: '',
    selectedId: '',
    selectMode: false
  },

  onLoad(options) {
    this.setData({
      from: options.from || '',
      selectedId: options.selectedId || '',
      selectMode: options.from === 'checkout'
    });
  },

  onShow() { this.loadAddresses(); },
  onPullDownRefresh() {
    this.loadAddresses().finally(() => wx.stopPullDownRefresh());
  },

  async loadAddresses() {
    this.setData({ loading: true, loadError: '' });
    const res = await API.getAddressList();
    if (res && res.success) {
      const list = (res.data || []).map(a => {
        let regionText = '';
        if (Array.isArray(a.region)) regionText = a.region.join(' ');
        else if (typeof a.region === 'string') regionText = a.region;
        return Object.assign({}, a, { regionText });
      });
      this.setData({ addresses: list, loading: false });
    } else {
      this.setData({ loading: false, loadError: (res && res.error) || '加载失败' });
    }
  },

  pickAddress(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.selectMode) return;
    const item = this.data.addresses.find(a => a._id === id);
    if (!item) return;
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && prev.setData) {
      prev.setData({ address: item });
      wx.navigateBack();
    } else {
      wx.navigateBack();
    }
  },

  editAddress(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + (id || '') });
  },

  addAddress() {
    wx.navigateTo({ url: '/pages/address-edit/address-edit' });
  },

  async deleteAddress(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '提示',
      content: '确定删除该地址？',
      success: async (r) => {
        if (r.confirm) {
          const res = await API.deleteAddress(id);
          if (res && res.success) {
            toast('已删除', 'success');
            this.loadAddresses();
          } else {
            toast((res && res.error) || '删除失败');
          }
        }
      }
    });
  },

  async setDefault(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.addresses.find(a => a._id === id);
    if (!item || item.isDefault) return;
    const res = await API.updateAddress(id, { isDefault: true });
    if (res && res.success) {
      toast('已设为默认', 'success');
      this.loadAddresses();
    }
  },

  retry() {
    this.setData({ loading: true, loadError: '' });
    this.loadAddresses();
  },

  onEmptyAction() {
    this.addAddress();
  }
});
