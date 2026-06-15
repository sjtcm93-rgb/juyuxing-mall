const API = require('../../utils/api');
const { toast, showLoading, hideLoading } = require('../../utils/util');

Page({
  data: {
    userInfo: {},
    isAgent: false,
    isAdmin: false,
    isLoggedIn: false,
    hasUserInfo: false
  },

  onShow() {
    this.loadUserInfo();
  },

  async loadUserInfo() {
    const openId = wx.getStorageSync('openId');
    const savedInfo = wx.getStorageSync('userInfo');
    
    if (!openId) {
      this.setData({ 
        isLoggedIn: false, 
        hasUserInfo: false,
        userInfo: {}
      });
      return;
    }

    getApp().globalData.openId = openId;
    this.setData({ 
      isLoggedIn: true,
      userInfo: savedInfo || {},
      hasUserInfo: !!(savedInfo && savedInfo.nickName)
    });
    
    // 检查代理状态
    try {
      const agentRes = await API.getAgentInfo();
      if (agentRes && agentRes.isAgent) {
        this.setData({ isAgent: true });
        getApp().globalData.isAgent = true;
      }
    } catch (err) {}
  
    // 检查管理权限
    try {
      const adminRes = await wx.cloud.callFunction({ name: 'admin', data: { action: 'dashboard' } });
      if (adminRes.result && adminRes.result.success) {
        this.setData({ isAdmin: true });
      }
    } catch (err) {}
  },

  // 点击头像或昵称触发登录/更新资料
  loginOrUpdateProfile() {
    const openId = wx.getStorageSync('openId');
    if (!openId) {
      this.getUserProfile();
    } else {
      // 已登录但没头像昵称，或者用户想更新
      if (!this.data.hasUserInfo) {
        this.getUserProfile();
      } else {
        // 已有完整资料，不做操作或可进入编辑
        wx.showToast({ title: '已登录', icon: 'success' });
      }
    }
  },

  // 获取微信用户信息
  getUserProfile() {
    // 使用 wx.getUserProfile（兼容现代接口）
    wx.getUserProfile({
      desc: '用于完善个人资料',
      success: async (res) => {
        const { nickName, avatarUrl } = res.userInfo;
        showLoading('登录中...');
        try {
          // 调用登录云函数（传用户信息）
          const loginRes = await API.login({ 
            ref: wx.getStorageSync('pendingReferrer') || getApp().getReferrer(),
            nickName,
            avatarUrl 
          });
          hideLoading();
          
          if (loginRes && loginRes.openId) {
            wx.setStorageSync('openId', loginRes.openId);
            wx.setStorageSync('userInfo', { nickName, avatarUrl });
            wx.removeStorageSync('pendingReferrer');
            
            getApp().globalData.openId = loginRes.openId;
            
            // 更新云端的用户信息
            await API.login({ 
              action: 'updateUserInfo',
              nickName, 
              avatarUrl 
            }).catch(() => {});
            
            this.setData({
              userInfo: { nickName, avatarUrl },
              isLoggedIn: true,
              hasUserInfo: true
            });
            toast('登录成功', 'success');
          }
        } catch (err) {
          hideLoading();
          toast('登录失败');
        }
      },
      fail: () => {
        // 用户拒绝授权或接口不可用，静默处理
        // 降级：仅使用 openId 登录
        this.loginWithOpenIdOnly();
      }
    });
  },

  // 静默登录（仅用 openId，没有用户信息）
  async loginWithOpenIdOnly() {
    const openId = wx.getStorageSync('openId');
    if (openId) return; // 已经登录过
    
    showLoading('登录中...');
    try {
      const ref = wx.getStorageSync('pendingReferrer') || getApp().getReferrer();
      const res = await API.login({ ref });
      hideLoading();
      
      if (res && res.openId) {
        wx.setStorageSync('openId', res.openId);
        wx.removeStorageSync('pendingReferrer');
        getApp().globalData.openId = res.openId;
        
        this.setData({ isLoggedIn: true });
      }
    } catch (err) {
      hideLoading();
    }
  },

  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 我的',
      path: `/pages/user/user?ref=${openId || ''}`
    };
  }
});
