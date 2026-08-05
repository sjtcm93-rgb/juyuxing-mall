Component({
  properties: {
    goods: { type: Object, value: {} },
    mode: { type: String, value: 'grid' },
    showBadge: { type: Boolean, value: false },
    badgeText: { type: String, value: '' },
    showAction: { type: Boolean, value: true }
  },
  data: { coverImage: '', priceYuan: '0.00', originalYuan: '', specText: '', soldText: '' },
  observers: {
    'goods': function (goods) {
      if (!goods) { return; }
      var cover = (goods.images && goods.images[0]) || '';
      var price = Number(goods.price) || 0;
      var original = Number(goods.originalPrice) || 0;
      var specs = goods.specs || [];
      this.setData({
        coverImage: cover,
        priceYuan: (price / 100).toFixed(2),
        originalYuan: original > price ? (original / 100).toFixed(2) : '',
        specText: specs[0] && specs[0].name ? specs[0].name : '',
        soldText: '已售 ' + (goods.sales || 0)
      });
    }
  },
  methods: {
    onTap() { this.triggerEvent('click', { goods: this.data.goods }); },
    onAction() { this.triggerEvent('action', { goods: this.data.goods }); }
  }
});
