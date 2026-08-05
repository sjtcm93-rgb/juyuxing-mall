App({
  globalData: {
    userInfo: null,
    openId: null,
    isAgent: false,
    hasPayment: false,
    envId: 'cloud1-d4gx1jxk675274501',
    cloudReady: false
  },

  onLaunch() {
    // 安全初始化云开发——如果未开通云环境也不会崩溃
    try {
      if (wx.cloud) {
        wx.cloud.init({
          env: this.globalData.envId,
          traceUser: true
        });
        this.globalData.cloudReady = true;
        console.log('[云开发] 初始化成功');
      } else {
        console.warn('[云开发] 当前环境不支持云开发，请在微信开发者工具中开通');
      }
    } catch (err) {
      console.warn('[云开发] 初始化失败:', err.message);
    }
    
    // 获取设备信息
    try {
      wx.getSystemInfo({
        success: (res) => {
          this.globalData.systemInfo = res;
        }
      });
    } catch (err) {
      console.warn('[系统信息] 获取失败:', err.message);
    }

    // 检查登录状态
    const openId = wx.getStorageSync('openId');
    if (openId) {
      this.globalData.openId = openId;
    }

    // 隐私授权拦截：当调用 getUserProfile 等隐私接口且用户未授权时，
    // 系统会自动触发此回调，由我们弹出品牌化授权框，用户同意后继续。
    if (typeof wx.onNeedPrivacyAuthorize === 'function') {
      wx.onNeedPrivacyAuthorize((resolve) => {
        // 暂存 resolve，交给当前页面的隐私弹窗在用户「同意」时调用
        this.privacyResolve = resolve;
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if (cur && typeof cur.showPrivacyPopup === 'function') {
          cur.showPrivacyPopup();
        } else {
          // 兜底：极端情况下当前页未挂载弹窗组件时，用系统弹窗保证流程不中断
          wx.showModal({
            title: '隐私授权',
            content: '使用前请阅读并同意《隐私保护指引》，我们将收集您的微信昵称、头像用于完善个人资料。',
            confirmText: '同意并继续',
            cancelText: '拒绝',
            success: (res) => resolve({ event: res.confirm ? 'agree' : 'disagree' })
          });
        }
      });
    }
  },

  // 获取代理推广参数
  getReferrer() {
    const query = wx.getEnterOptionsSync().query;
    return query.ref || null;
  }
})
