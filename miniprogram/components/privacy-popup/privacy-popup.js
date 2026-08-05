Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    // 打开平台隐私保护指引（需在 MP 后台「隐私保护指引」中已配置）
    openContract() {
      wx.openPrivacyContract({
        fail: () => {
          wx.showToast({ title: '暂无法打开隐私指引', icon: 'none' });
        }
      });
    },
    onAgree() {
      this.triggerEvent('agree');
    },
    onDisagree() {
      this.triggerEvent('disagree');
    }
  }
});
