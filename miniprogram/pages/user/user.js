const API = require('../../utils/api');
const { toast } = require('../../utils/util');

Page({
  data: {
    userInfo: {},
    isAgent: false,
    isAdmin: false,
    isLoggedIn: false,
    hasUserInfo: false,
    showPrivacy: false,
    orderCounts: { pending: 0, paid: 0, shipped: 0, refunding: 0 }
  },

  onShow() {
    this.loadUserInfo();
    this.loadOrderCounts();
  },

  async loadUserInfo() {
    const openId = wx.getStorageSync('openId');
    const savedInfo = wx.getStorageSync('userInfo');
    if (!openId) {
      this.setData({ isLoggedIn: false, hasUserInfo: false, isAdmin: false, isAgent: false, userInfo: {} });
      return;
    }
    getApp().globalData.openId = openId;
    this.setData({
      isLoggedIn: true,
      userInfo: savedInfo || {},
      hasUserInfo: !!(savedInfo && savedInfo.nickName)
    });
    try {
      const agentRes = await API.getAgentInfo({ silent: true });
      if (agentRes && agentRes.isAgent) {
        this.setData({ isAgent: true });
        getApp().globalData.isAgent = true;
      }
    } catch (e) {}
    // 管理员权限：登录后只校验一次并缓存（按 openId 隔离），避免每次 onShow 浪费云函数调用
    const adminCacheKey = 'isAdmin_' + openId;
    const cachedAdmin = wx.getStorageSync(adminCacheKey);
    if (typeof cachedAdmin === 'boolean') {
      this.setData({ isAdmin: cachedAdmin });
      return;
    }
    try {
      const adminRes = await wx.cloud.callFunction({ name: 'admin', data: { action: 'checkAdmin' } });
      const isAdmin = !!(adminRes.result && adminRes.result.success);
      this.setData({ isAdmin });
      wx.setStorageSync(adminCacheKey, isAdmin); // 缓存结果，后续 onShow 不再重复请求
    } catch (e) {}
  },

  async loadOrderCounts() {
    if (!wx.getStorageSync('openId')) return;
    // 统一走 getOrderList，不依赖 myRefunds 新接口
    const promises = [
      API.getOrderList({ status: 'pending', pageSize: 1 }, { silent: true }),
      API.getOrderList({ status: 'paid', pageSize: 1 }, { silent: true }),
      API.getOrderList({ status: 'shipped', pageSize: 1 }, { silent: true }),
      API.getOrderList({ status: 'refunding', pageSize: 1 }, { silent: true })
    ];
    try {
      const results = await Promise.all(promises);
      this.setData({
        orderCounts: {
          pending: (results[0] && results[0].total) || 0,
          paid: (results[1] && results[1].total) || 0,
          shipped: (results[2] && results[2].total) || 0,
          refunding: (results[3] && results[3].total) || 0
        }
      });
    } catch (e) {}
  },

  loginOrUpdateProfile() {
    if (!wx.getStorageSync('openId')) this.getUserProfile();
    else if (!this.data.hasUserInfo) this.getUserProfile();
    else toast('已登录', 'success');
  },

  getUserProfile() {
    wx.getUserProfile({
      desc: '用于完善个人资料',
      success: async (res) => {
        const { nickName, avatarUrl } = res.userInfo;
        try {
          const ref = wx.getStorageSync('pendingReferrer') || getApp().getReferrer();
          const loginRes = await API.login({ ref, nickName, avatarUrl });
          if (loginRes && loginRes.openId) {
            wx.setStorageSync('openId', loginRes.openId);
            wx.setStorageSync('userInfo', { nickName, avatarUrl });
            wx.removeStorageSync('pendingReferrer');
            getApp().globalData.openId = loginRes.openId;
            this.setData({ userInfo: { nickName, avatarUrl }, isLoggedIn: true, hasUserInfo: true });
            toast('登录成功', 'success');
            this.loadUserInfo();
          }
        } catch (err) {
          toast('登录失败');
        }
      },
      fail: () => this.loginWithOpenIdOnly()
    });
  },

  // 隐私拦截器触发时由 app.js 调用，弹出品牌化授权框
  showPrivacyPopup() {
    this.setData({ showPrivacy: true });
  },

  onPrivacyAgree() {
    this.setData({ showPrivacy: false });
    const resolve = getApp().privacyResolve;
    if (resolve) resolve({ event: 'agree' });
  },

  onPrivacyDisagree() {
    this.setData({ showPrivacy: false });
    const resolve = getApp().privacyResolve;
    if (resolve) resolve({ event: 'disagree' });
    // 用户拒绝隐私授权时，降级为仅用 openId 登录（不取昵称/头像）
    this.loginWithOpenIdOnly();
  },

  async loginWithOpenIdOnly() {
    if (wx.getStorageSync('openId')) return;
    try {
      const ref = wx.getStorageSync('pendingReferrer') || getApp().getReferrer();
      const res = await API.login({ ref });
      if (res && res.openId) {
        wx.setStorageSync('openId', res.openId);
        wx.removeStorageSync('pendingReferrer');
        getApp().globalData.openId = res.openId;
        this.setData({ isLoggedIn: true });
      }
    } catch (e) {}
  },

  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 我的',
      path: `/pages/user/user?ref=${openId || ''}`
    };
  }
});
