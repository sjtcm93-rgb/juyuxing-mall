'use strict';

const API = require('../../../utils/api');

Page({
  data: { info: {}, userInfo: {} },
  async onShow() {
    const info = await API.getAgentInfo({ silent: true });
    this.setData({ info: info || {}, userInfo: wx.getStorageSync('userInfo') || {} });
  },
  copyCode() {
    if (!this.data.info.code) return;
    wx.setClipboardData({ data: this.data.info.code });
  }
});
