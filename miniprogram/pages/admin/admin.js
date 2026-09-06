const { toast, formatTime, showLoading, hideLoading, decorateItem, decorateList } = require('../../utils/util');

Page({
  data: {
    tab: 'dashboard',
    stats: { totalOrders:0, paidOrders:0, shippedOrders:0, totalSales:0, pendingAgents:0, pendingWithdrawals:0, pendingRefunds:0 },
    orders: [],
    pendingAgents: [],
    pendingWithdrawals: [],
    pendingRefunds: [],
    products: [],
    shipTarget: '',
    company: '',
    trackingNo: '',
    refundNote: '',
    // 商品表单
    showProductForm: false,
    editingProductId: '',
    productForm: {
      name: '',
      subtitle: '',
      price: '',
      originalPrice: '',
      stock: '',
      specs: '',
      images: '',
      description: '',
      category: '',
      status: 'on'
    },
    // Banner管理
    banners: [],
    showBannerForm: false,
    editingBannerId: '',
    bannerForm: {
      imageUrl: '',
      linkUrl: '',
      title: '',
      sort: '0',
      status: 'on'
    },
    // 客服会话
    chatConversations: [],
    chatUnreadCount: 0,
    // 筛选状态
    orderFilter: 'paid',
    refundFilter: 'pending',
    withdrawalFilter: 'pending',
    agentFilter: 'pending'
  },

  onLoad() {
    this.loadDashboard();
  },

  onShow() {
    // 防止从「我的」退出登录后回 admin 还显示已登录
    const openId = wx.getStorageSync('openId');
    if (!openId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/user/user' }), 600);
    }
  },

  switchTab(e) {
    const tab = typeof e === 'string' ? e : e.currentTarget.dataset.tab;
    this.setData({ tab, showProductForm: false, showBannerForm: false });
    if (tab === 'dashboard') this.loadDashboard();
    if (tab === 'orders') this.loadOrders();
    if (tab === 'agents') this.loadPendingAgents();
    if (tab === 'withdrawals') this.loadPendingWithdrawals();
    if (tab === 'refunds') this.loadPendingRefunds();
    if (tab === 'products') this.loadProducts();
    if (tab === 'banners') this.loadBanners();
    if (tab === 'chat') this.loadChatConversations();
  },

  async loadDashboard() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'dashboard' } });
      if (res.result && res.result.success) this.setData({ stats: decorateItem(res.result.stats) });
    } catch (err) { toast('加载数据失败'); }
    // 同时加载未读客服消息数
    try {
      const chatRes = await wx.cloud.callFunction({ name: 'chat', data: { action: 'getUnreadCount' } });
      if (chatRes.result && chatRes.result.success) {
        this.setData({ chatUnreadCount: chatRes.result.count || 0 });
      }
    } catch (err) {}
  },

  async loadOrders() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'orderList', status: this.data.orderFilter === 'all' ? '' : this.data.orderFilter } });
      if (res.result && res.result.success) this.setData({ orders: decorateList(res.result.data || []).map(o => Object.assign({}, o, { items: decorateList(o.items || []) })) });
    } catch (err) { toast('加载订单失败'); }
  },

  switchOrderFilter(e) {
    this.setData({ orderFilter: e.currentTarget.dataset.filter });
    this.loadOrders();
  },

  showShipForm(e) {
    this.setData({ shipTarget: e.currentTarget.dataset.orderId, company: '', trackingNo: '' });
  },

  cancelShip() {
    this.setData({ shipTarget: '', company: '', trackingNo: '' });
  },

  onCompanyInput(e) { this.setData({ company: e.detail.value }); },
  onTrackingInput(e) { this.setData({ trackingNo: e.detail.value }); },

  async confirmShip(e) {
    const { company, trackingNo } = this.data;
    if (!company || !trackingNo) { toast('请填写物流信息'); return; }
    showLoading('发货中...');
    try {
      const r = await wx.cloud.callFunction({
        name: 'admin',
        data: { action: 'shipOrder', orderId: e.currentTarget.dataset.orderId, company, trackingNo }
      });
      hideLoading();
      if (r.result && r.result.success) {
        toast('已发货', 'success');
        this.setData({ shipTarget: '', company: '', trackingNo: '' });
        this.loadOrders();
        this.loadDashboard();
      } else {
        toast((r.result && r.result.error) || '发货失败');
      }
    } catch (err) { hideLoading(); toast('发货失败'); }
  },

  async loadPendingAgents() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'agentList', statusFilter: this.data.agentFilter } });
      if (res.result && res.result.success) {
        // 预处理可选链数据（WXML 不支持 ?.）
        const agents = (res.result.data || []).map(item => {
          return {
            ...item,
            agentName: (item.agentInfo && item.agentInfo.name) || item.nickName || '未知用户',
            agentWechat: (item.agentInfo && item.agentInfo.wechat) || '-',
            agentPhone: (item.agentInfo && item.agentInfo.phone) || '-',
            agentReason: (item.agentInfo && item.agentInfo.reason) || '',
            agentStatus: (item.agentInfo && item.agentInfo.status) || '-'
          };
        });
        this.setData({ pendingAgents: agents });
      }
    } catch (err) { toast('加载代理申请失败'); }
  },

  switchAgentFilter(e) {
    this.setData({ agentFilter: e.currentTarget.dataset.filter });
    this.loadPendingAgents();
  },

  async approveAgent(e) {
    const { userId, approve } = e.currentTarget.dataset;
    wx.showModal({
      title: approve ? '确认通过' : '确认拒绝',
      content: approve ? '通过后该用户将成为代理' : '拒绝后该用户将无法成为代理',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading(approve ? '通过中...' : '拒绝中...');
        try {
          const r = await wx.cloud.callFunction({ name: 'admin', data: { action: 'approveAgent', userId, approve: !!approve } });
          hideLoading();
          if (r.result && r.result.success) {
            toast(approve ? '已通过' : '已拒绝', 'success');
            this.loadPendingAgents();
            this.loadDashboard();
          } else {
            toast((r.result && r.result.error) || '操作失败');
          }
        } catch (err) { hideLoading(); toast('操作失败'); }
      }
    });
  },

  async loadPendingWithdrawals() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'withdrawalList', statusFilter: this.data.withdrawalFilter } });
      if (res.result && res.result.success) this.setData({ pendingWithdrawals: decorateList(res.result.data || []) });
    } catch (err) { toast('加载提现申请失败'); }
  },

  switchWithdrawalFilter(e) {
    this.setData({ withdrawalFilter: e.currentTarget.dataset.filter });
    this.loadPendingWithdrawals();
  },

  async processWithdrawal(e) {
    const { wdId, approve } = e.currentTarget.dataset;
    wx.showModal({
      title: approve ? '确认打款' : '确认拒绝',
      content: approve ? '确认已通过线下打款？此操作不可撤销' : '拒绝后用户可重新申请提现',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading(approve ? '确认中...' : '拒绝中...');
        try {
          const r = await wx.cloud.callFunction({
            name: 'admin',
            data: { action: 'processWithdrawal', withdrawalId: wdId, approve: !!approve }
          });
          hideLoading();
          if (r.result && r.result.success) {
            toast(approve ? '打款确认' : '已拒绝', 'success');
            this.loadPendingWithdrawals();
            this.loadDashboard();
          } else {
            toast((r.result && r.result.error) || '操作失败');
          }
        } catch (err) { hideLoading(); toast('操作失败'); }
      }
    });
  },

  async loadPendingRefunds() {
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'refundList', statusFilter: this.data.refundFilter } });
      if (res.result && res.result.success) {
        this.setData({ pendingRefunds: decorateList(res.result.data || []).map(r => Object.assign({}, r, { order: r.order ? Object.assign({}, r.order, { items: decorateList(r.order.items || []) }) : r.order })) });
      }
    } catch (err) { toast('加载退款申请失败'); }
  },

  switchRefundFilter(e) {
    this.setData({ refundFilter: e.currentTarget.dataset.filter });
    this.loadPendingRefunds();
  },

  async processRefund(e) {
    const { refundId, approve } = e.currentTarget.dataset;
    const adminNote = this.data.refundNote || '';
    wx.showModal({
      title: approve ? '确认同意退款' : '确认拒绝退款',
      content: approve ? '同意后将通过微信支付原路退回，确定吗？' : '拒绝后订单将恢复原状态，确定吗？',
      confirmText: approve ? '同意' : '拒绝',
      confirmColor: approve ? '#FA5151' : '#999',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading(approve ? '退款处理中...' : '拒绝中...');
        try {
          const r = await wx.cloud.callFunction({
            name: 'admin',
            data: { action: 'processRefund', refundId, approve: !!approve, adminNote }
          });
          hideLoading();
          if (r.result && r.result.success) {
            toast(r.result.message || (approve ? '已同意退款' : '已拒绝退款'), 'success');
            this.setData({ refundNote: '' });
            this.loadPendingRefunds();
            this.loadDashboard();
          } else {
            toast((r.result && r.result.error) || '操作失败');
          }
        } catch (err) { hideLoading(); toast('操作失败：' + (err.message || '')); }
      }
    });
  },

  onRefundNoteInput(e) { this.setData({ refundNote: e.detail.value }); },

  async loadProducts() {
    showLoading('加载商品...');
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'productList' } });
      hideLoading();
      if (res.result && res.result.success) {
        this.setData({ products: decorateList(res.result.data || []) });
      }
    } catch (err) { hideLoading(); toast('加载商品失败'); }
  },

  showProductForm(e) {
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : '';
    if (id) {
      // 编辑模式：填充表单
      const product = this.data.products.find(p => p._id === id);
      if (!product) return;
      this.setData({
        showProductForm: true,
        editingProductId: id,
        productForm: {
          name: product.name || '',
          subtitle: product.subtitle || '',
          price: product.price ? String(product.price / 100) : '',
          originalPrice: product.originalPrice ? String(product.originalPrice / 100) : '',
          stock: String(product.stock || 0),
          specs: (product.specs || []).map(s => s.name).join(','),
          images: (product.images || []).join('\n'),
          description: product.description || '',
          category: product.category || '',
          status: product.status || 'on'
        }
      });
    } else {
      // 新增模式
      this.setData({
        showProductForm: true,
        editingProductId: '',
        productForm: {
          name: '',
          subtitle: '',
          price: '',
          originalPrice: '',
          stock: '',
          specs: '',
          images: '',
          description: '',
          category: '',
          status: 'on'
        }
      });
    }
  },

  hideProductForm() {
    this.setData({ showProductForm: false });
  },

  onProductInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.currentTarget.dataset.value !== undefined ? e.currentTarget.dataset.value : e.detail.value;
    this.setData({ ['productForm.' + field]: value });
  },

  async saveProduct() {
    const form = this.data.productForm;
    if (!form.name || !form.price) {
      toast('请填写商品名称和价格'); return;
    }
    const priceFen = Math.round(parseFloat(form.price) * 100);
    const originalPriceFen = form.originalPrice ? Math.round(parseFloat(form.originalPrice) * 100) : 0;
    const stock = parseInt(form.stock) || 0;
    const specs = (form.specs || '').split(',').map(s => s.trim()).filter(Boolean).map(s => ({ name: s, stock }));
    const images = (form.images || '').split('\n').map(s => s.trim()).filter(Boolean);

    const payload = {
      name: form.name,
      subtitle: form.subtitle,
      price: priceFen,
      originalPrice: originalPriceFen,
      stock,
      specs: specs.length > 0 ? specs : [{ name: '默认规格', stock }],
      images,
      description: form.description,
      category: form.category,
      status: form.status
    };

    showLoading('保存中...');
    try {
      const id = this.data.editingProductId;
      if (id) {
        await wx.cloud.callFunction({
          name: 'admin',
          data: { action: 'updateProduct', id, ...payload }
        });
        toast('商品已更新', 'success');
      } else {
        await wx.cloud.callFunction({
          name: 'admin',
          data: { action: 'createProduct', ...payload }
        });
        toast('商品已创建', 'success');
      }
      hideLoading();
      this.setData({ showProductForm: false });
      this.loadProducts();
    } catch (err) {
      hideLoading();
      toast(err.message || '保存失败');
    }
  },

  async toggleProductStatus(e) {
    const id = e.currentTarget.dataset.id;
    const product = this.data.products.find(p => p._id === id);
    if (!product) return;
    const newStatus = product.status === 'on' ? 'off' : 'on';
    showLoading(product.status === 'on' ? '下架中...' : '上架中...');
    try {
      await wx.cloud.callFunction({
        name: 'admin',
        data: { action: 'toggleProductStatus', id, status: newStatus }
      });
      hideLoading();
      toast(newStatus === 'on' ? '已上架' : '已下架', 'success');
      this.loadProducts();
    } catch (err) { hideLoading(); toast('操作失败'); }
  },

  async deleteProduct(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FA5151',
      success: async (res) => {
        if (res.confirm) {
          showLoading('删除中...');
          try {
            const r = await wx.cloud.callFunction({
              name: 'admin',
              data: { action: 'deleteProduct', id }
            });
            hideLoading();
            if (r.result && r.result.success) {
              toast('已删除', 'success');
              this.loadProducts();
            } else {
              toast(r.result.error || '删除失败');
            }
          } catch (err) { hideLoading(); toast('删除失败'); }
        }
      }
    });
  },

  async loadBanners() {
    showLoading('加载中...');
    try {
      const res = await wx.cloud.callFunction({ name: 'admin', data: { action: 'bannerList' } });
      hideLoading();
      if (res.result && res.result.success) {
        this.setData({ banners: decorateList(res.result.data || []) });
      }
    } catch (err) { hideLoading(); toast('加载轮播图失败'); }
  },

  showBannerForm(e) {
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : '';
    if (id) {
      const banner = this.data.banners.find(b => b._id === id);
      if (!banner) return;
      this.setData({
        showBannerForm: true,
        editingBannerId: id,
        bannerForm: {
          imageUrl: banner.imageUrl || '',
          linkUrl: banner.linkUrl || '',
          title: banner.title || '',
          sort: String(banner.sort || 0),
          status: banner.status || 'on'
        }
      });
    } else {
      this.setData({
        showBannerForm: true,
        editingBannerId: '',
        bannerForm: { imageUrl: '', linkUrl: '', title: '', sort: '0', status: 'on' }
      });
    }
  },

  hideBannerForm() {
    this.setData({ showBannerForm: false });
  },

  onBannerInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.currentTarget.dataset.value !== undefined ? e.currentTarget.dataset.value : e.detail.value;
    this.setData({ ['bannerForm.' + field]: value });
  },

  async saveBanner() {
    const form = this.data.bannerForm;
    if (!form.imageUrl) { toast('请填写图片链接'); return; }
    const payload = {
      imageUrl: form.imageUrl.trim(),
      linkUrl: form.linkUrl || '',
      title: form.title || '',
      sort: Number(form.sort) || 0,
      status: form.status
    };
    showLoading('保存中...');
    try {
      const id = this.data.editingBannerId;
      if (id) {
        await wx.cloud.callFunction({
          name: 'admin',
          data: { action: 'updateBanner', id, ...payload }
        });
        toast('已更新', 'success');
      } else {
        await wx.cloud.callFunction({
          name: 'admin',
          data: { action: 'createBanner', ...payload }
        });
        toast('已创建', 'success');
      }
      hideLoading();
      this.setData({ showBannerForm: false });
      this.loadBanners();
    } catch (err) {
      hideLoading();
      toast('保存失败');
    }
  },

  async toggleBanner(e) {
    const id = e.currentTarget.dataset.id;
    const banner = this.data.banners.find(b => b._id === id);
    if (!banner) return;
    const newStatus = banner.status === 'on' ? 'off' : 'on';
    showLoading('切换中...');
    try {
      await wx.cloud.callFunction({
        name: 'admin',
        data: { action: 'toggleBanner', id, status: newStatus }
      });
      hideLoading();
      toast(newStatus === 'on' ? '已启用' : '已禁用', 'success');
      this.loadBanners();
    } catch (err) { hideLoading(); toast('操作失败'); }
  },

  async deleteBanner(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FA5151',
      success: async (res) => {
        if (res.confirm) {
          showLoading('删除中...');
          try {
            const r = await wx.cloud.callFunction({
              name: 'admin',
              data: { action: 'deleteBanner', id }
            });
            hideLoading();
            if (r.result && r.result.success) {
              toast('已删除', 'success');
              this.loadBanners();
            } else {
              toast((r.result && r.result.error) || '删除失败');
            }
          } catch (err) { hideLoading(); toast('删除失败'); }
        }
      }
    });
  },

  async loadChatConversations() {
    showLoading('加载会话...');
    try {
      const res = await wx.cloud.callFunction({ name: 'chat', data: { action: 'getConversationList' } });
      hideLoading();
      if (res.result && res.result.success) {
        const convs = res.result.data || [];
        // 预处理时间，避免模板复杂逻辑
        const processed = convs.map(c => Object.assign({}, c, {
          lastMessage: c.lastMessage ? decorateItem(c.lastMessage) : c.lastMessage
        }));
        this.setData({
          chatConversations: processed,
          chatUnreadCount: processed.reduce((s, c) => s + (c.unreadCount || 0), 0)
        });
      }
    } catch (err) { hideLoading(); toast('加载会话失败'); }
  },

  enterChat(e) {
    const idx = e.currentTarget.dataset.index;
    const conv = this.data.chatConversations[idx];
    if (!conv) return;
    const userInfo = encodeURIComponent(JSON.stringify(conv.userInfo || {}));
    wx.navigateTo({
      url: `/pages/chat/chat?toId=${conv.userId}&isAdmin=true&userInfo=${userInfo}`
    });
  }
});
