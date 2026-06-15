const API = require('../../utils/api');
const { toast, formatTime } = require('../../utils/util');

Page({
  data: {
    userInfo: {},
    agentInfo: { code: '', level: '初级代理' },
    stats: { totalCommission:0, available:0, teamCount:0, monthSales:0, monthCommission:0, monthOrders:0 },
    commissions: []
  },
  onShow() { this.loadData(); },
  async loadData() {
    try {
      const [infoRes, perfRes, teamRes, commRes] = await Promise.all([
        API.getAgentInfo().catch(() => ({})),
        API.getAgentPerformance().catch(() => ({})),
        API.getAgentTeam().catch(() => ({})),
        API.getAgentCommissions({ pageSize: 10 }).catch(() => ({}))
      ]);
      const userInfo = wx.getStorageSync('userInfo') || {};
      this.setData({
        userInfo,
        agentInfo: { code: infoRes.code || '', level: infoRes.level || '初级代理', ...infoRes },
        stats: {
          totalCommission: (perfRes.totalCommission || 0) / 100,
          available: (perfRes.available || 0) / 100,
          teamCount: (teamRes.total || 0),
          monthSales: (perfRes.monthSales || 0) / 100,
          monthCommission: (perfRes.monthCommission || 0) / 100,
          monthOrders: perfRes.monthOrders || 0
        },
        commissions: (commRes.data || []).slice(0, 10)
      });
    } catch (err) { toast('加载代理数据失败'); }
  },
  copyCode() {
    wx.setClipboardData({
      data: this.data.agentInfo.code,
      success: () => toast('推广码已复制','success')
    });
  },
  shareApp() {
    wx.showShareMenu({ withShareTicket: true });
  },
  formatTime(t) { return t ? formatTime(new Date(t)) : ''; },
  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 自然疗愈好物',
      path: `/pages/index/index?ref=${openId || ''}`,
      imageUrl: '../../images/share-banner.png'
    };
  }
});
