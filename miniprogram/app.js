const cloud = require('./utils/cloud.js');

App({
  globalData: {
    userInfo: null,
    openId: null,
    isAgent: false,
    hasPayment: false,
    envId: 'cloud1-d4gx1jxk675274501'
  },

  onLaunch() {
    cloud.init();
    
    // 获取设备信息
    wx.getSystemInfo({
      success: (res) => {
        this.globalData.systemInfo = res;
      }
    });

    // 检查登录状态
    const openId = wx.getStorageSync('openId');
    if (openId) {
      this.globalData.openId = openId;
    }
  },

  // 获取代理推广参数
  getReferrer() {
    const query = wx.getEnterOptionsSync().query;
    return query.ref || null;
  }
})
