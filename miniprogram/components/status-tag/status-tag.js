Component({
  properties: {
    status: { type: String, value: 'pending' },
    text: { type: String, value: '' }
  },
  data: { label: '', cls: 'tag-default' },
  observers: {
    'status, text': function (status, text) {
      var map = {
        pending: { label: '待支付', cls: 'tag-pending' },
        paid: { label: '待发货', cls: 'tag-paid' },
        shipped: { label: '已发货', cls: 'tag-shipped' },
        received: { label: '已收货', cls: 'tag-received' },
        refunding: { label: '退款中', cls: 'tag-refund' },
        refunded: { label: '已退款', cls: 'tag-refund' },
        cancelled: { label: '已取消', cls: 'tag-cancel' },
        closed: { label: '已关闭', cls: 'tag-cancel' },
        approved: { label: '已同意', cls: 'tag-success' },
        rejected: { label: '已拒绝', cls: 'tag-danger' },
        settled: { label: '已结算', cls: 'tag-success' },
        frozen: { label: '冻结中', cls: 'tag-pending' },
        cancelled_commission: { label: '已取消', cls: 'tag-cancel' },
        on: { label: '上架', cls: 'tag-success' },
        off: { label: '下架', cls: 'tag-cancel' }
      };
      var conf = map[status] || { label: status, cls: 'tag-default' };
      this.setData({ label: text || conf.label, cls: conf.cls });
    }
  }
});
