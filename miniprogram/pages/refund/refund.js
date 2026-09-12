const API = require('../../utils/api');
const { toast, formatTime } = require('../../utils/util');

Page({
  data: {
    mode: 'submit', // 'submit' | 'detail'
    orderId: '',
    refundId: '',
    order: null,
    refund: null,
    reason: '',
    description: '',
    images: [],
    reasons: ['不想要了', '商品质量问题', '收到错误商品', '商品与描述不符', '其他原因'],
    submitting: false
  },

  onLoad(options) {
    if (options.id) {
      // 查看退款详情模式
      this.setData({ mode: 'detail', refundId: options.id });
      this.loadRefundDetail(options.id);
    } else if (options.orderId) {
      // 提交退款申请模式
      this.setData({ mode: 'submit', orderId: options.orderId });
      this.loadOrder(options.orderId);
    }
  },

  async loadOrder(id) {
    const res = await API.getOrderDetail(id, { silent: true });
    if (res && res.success && res.data) {
      const order = res.data;
      const totalFee = Number(order.totalFee) || 0;
      const items = (order.items || []).map(it => ({
        name: it.name,
        spec: it.spec,
        quantity: it.quantity,
        priceText: ((Number(it.price) || 0) / 100).toFixed(2)
      }));
      this.setData({
        order: order,
        refundAmountText: (totalFee / 100).toFixed(2),
        orderItems: items
      });
    }
  },

  async loadRefundDetail(refundId) {
    const res = await API.getRefundDetail(refundId, { silent: true });
    if (res && res.success && res.data) {
      const refund = res.data;
      const statusMap = {
        pending: '审核中',
        pending_auto: '已批准，等待执行',
        processing: '退款核对中',
        channel_processing: '微信退款处理中',
        manual_review: '退款待商家核查',
        approved: '已退款',
        rejected: '已拒绝'
      };
      this.setData({
        refund: refund,
        refundStatusText: refund.refundChannel === 'wechat_manual' ? '退款结果待商家核对' : (statusMap[refund.status] || '处理中'),
        refundCreateTime: refund.createTime ? formatTime(refund.createTime) : ''
      });
      // 同时加载关联订单信息
      if (refund.orderId) {
        this.loadOrder(refund.orderId);
      }
    } else {
      toast('加载退款详情失败');
    }
  },

  pickReason(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ reason: this.data.reasons[idx] });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.reason) { toast('请选择退款原因'); return; }
    if (!this.data.orderId) { toast('订单信息缺失'); return; }
    this.setData({ submitting: true });
    const res = await API.requestRefund(this.data.orderId, {
      reason: this.data.reason,
      description: this.data.description
    });
    this.setData({ submitting: false });
    if (res && res.success) {
      toast('退款申请已提交', 'success');
      setTimeout(() => wx.navigateBack(), 800);
    } else {
      toast((res && res.error) || '提交失败');
    }
  }
});
