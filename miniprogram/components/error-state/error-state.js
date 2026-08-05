Component({
  properties: {
    text: { type: String, value: '加载失败，请重试' },
    icon: { type: String, value: '' },
    showRetry: { type: Boolean, value: true }
  },
  methods: {
    onRetry() { this.triggerEvent('retry'); }
  }
});
