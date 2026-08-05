Component({
  properties: {
    value: { type: null, value: 0 },
    original: { type: null, value: 0 },
    size: { type: String, value: 'md' },
    showSymbol: { type: Boolean, value: true },
    color: { type: String, value: 'primary' }
  },
  data: {
    valueText: '0.00',
    originalText: ''
  },
  observers: {
    'value, original'(value, original) {
      const v = Number(value);
      const o = Number(original);
      this.setData({
        valueText: (isNaN(v) ? 0 : v / 100).toFixed(2),
        originalText: (original && !isNaN(o) && o > 0) ? (o / 100).toFixed(2) : ''
      });
    }
  }
});
