'use strict';

const API = require('../../../utils/api');
const { toast } = require('../../../utils/util');

function money(value) { return ((Number(value) || 0) / 100).toFixed(2); }

Page({
  data: { loading: true, unauthorized: false, stats: {}, code: '' },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true });
    try {
      const result = await API.getAgentDashboard({ silent: true });
      if (!result || !result.success) {
        this.setData({ loading: false, unauthorized: true });
        return;
      }
      this.setData({
        loading: false, unauthorized: false, code: result.code || '',
        stats: {
          monthSales: money(result.monthSales), monthOrders: result.monthOrders || 0,
          frozen: money(result.frozen), available: money(result.available),
          paid: money(result.paid), totalCommission: money(result.totalCommission),
          teamCount: result.teamCount || 0
        }
      });
    } catch (e) {
      this.setData({ loading: false });
      toast('数据加载失败');
    }
  },

  goPromotion() { wx.navigateTo({ url: '/subpackages/distributor/promotion/promotion' }); },
  goCommissions() { wx.navigateTo({ url: '/subpackages/distributor/commissions/commissions' }); },
  goWithdrawal() { wx.navigateTo({ url: '/subpackages/distributor/withdrawal/withdrawal' }); },
  goProfile() { wx.navigateTo({ url: '/subpackages/distributor/profile/profile' }); }
});
