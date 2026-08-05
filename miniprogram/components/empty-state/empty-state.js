Component({
  properties: {
    text: { type: String, value: '暂无数据' },
    icon: { type: String, value: '' },
    showAction: { type: Boolean, value: false },
    actionText: { type: String, value: '去逛逛' },
    height: { type: String, value: '' }
  },
  methods: {
    onAction() { this.triggerEvent('action'); }
  }
});
