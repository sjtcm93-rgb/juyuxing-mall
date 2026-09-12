Component({
  properties: {
    goods: { type: Object, value: {} },
    mode: { type: String, value: 'grid' },
    wide: { type: Boolean, value: false },
    showBadge: { type: Boolean, value: false },
    badgeText: { type: String, value: '' },
    detailText: { type: String, value: '' },
    actionText: { type: String, value: '立即购买' },
    displayImage: { type: String, value: '' },
    dynamic: { type: Boolean, value: false },
    referenceArt: { type: Boolean, value: false },
    showAction: { type: Boolean, value: true }
  },
  data: {
    artworkError: false,
    coverImage: '',
    priceYuan: '0.00',
    originalYuan: '',
    widePriceYuan: '0',
    wideOriginalYuan: '',
    specText: '',
    soldText: ''
  },
  observers: {
    'goods, displayImage': function (goods, displayImage) {
      if (!goods) { return; }
      var cover = displayImage || (goods.images && goods.images[0]) || '';
      var price = Number(goods.price) || 0;
      var original = Number(goods.originalPrice) || 0;
      var specs = goods.specs || [];
      this.setData({
        coverImage: cover,
        priceYuan: (price / 100).toFixed(2),
        originalYuan: original > price ? (original / 100).toFixed(2) : '',
        widePriceYuan: this.formatCompactPrice(price),
        wideOriginalYuan: original > price ? this.formatCompactPrice(original) : '',
        specText: specs[0] && specs[0].name ? specs[0].name : '',
        soldText: '已售 ' + (goods.sales || 0)
      });
    }
  },
  methods: {
    onArtworkError() { this.setData({ artworkError: true }); },
    formatCompactPrice(fen) {
      return ((Number(fen) || 0) / 100)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
    },
    onTap() { this.triggerEvent('click', { goods: this.data.goods }); },
    onAction() { this.triggerEvent('action', { goods: this.data.goods }); }
  }
});
