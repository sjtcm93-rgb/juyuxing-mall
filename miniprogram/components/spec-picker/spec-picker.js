Component({
  properties: {
    show: { type: Boolean, value: false },
    goods: { type: Object, value: {} },
    quantity: { type: Number, value: 1 }
  },
  data: {
    selectedSpec: 0,
    currentQty: 1,
    maxStock: 999,
    specName: '',
    priceYuan: '0.00',
    cover: ''
  },
  observers: {
    'show': function (s) { if (s) this.reset(); }
  },
  lifetimes: {
    ready() { this.reset(); }
  },
  methods: {
    reset() {
      var g = this.data.goods || {};
      var specs = g.specs || [];
      var idx = 0;
      var stock = 999;
      var name = '';
      if (specs.length > 0) {
        idx = 0;
        stock = (specs[0] && typeof specs[0].stock === 'number') ? specs[0].stock : 999;
        name = specs[0] ? specs[0].name : '';
      }
      // 规格价优先，缺失时回退商品主价（与服务端口径一致）
      var price = (specs[0] && Number(specs[0].price)) || Number(g.price) || 0;
      this.setData({
        selectedSpec: idx,
        currentQty: 1,
        maxStock: stock,
        specName: name,
        priceYuan: (price / 100).toFixed(2),
        cover: (g.images && g.images[0]) || ''
      });
    },
    onMaskTap() { this.triggerEvent('close'); },
    onStop() {},
    selectSpec(e) {
      var idx = e.currentTarget.dataset.index;
      var g = this.data.goods || {};
      var specs = g.specs || [];
      var stock = (specs[idx] && typeof specs[idx].stock === 'number') ? specs[idx].stock : 999;
      var price = (specs[idx] && Number(specs[idx].price)) || Number(g.price) || 0;
      this.setData({
        selectedSpec: idx,
        maxStock: stock,
        specName: (specs[idx] && specs[idx].name) || '',
        currentQty: 1,
        priceYuan: (price / 100).toFixed(2)
      });
    },
    dec() { if (this.data.currentQty > 1) this.setData({ currentQty: this.data.currentQty - 1 }); },
    inc() {
      if (this.data.currentQty < this.data.maxStock) {
        this.setData({ currentQty: this.data.currentQty + 1 });
      } else {
        wx.showToast({ title: '已达最大库存', icon: 'none' });
      }
    },
    onConfirm() {
      this.triggerEvent('confirm', {
        specIndex: this.data.selectedSpec,
        specName: this.data.specName,
        quantity: this.data.currentQty
      });
    },
    onCart() {
      this.triggerEvent('addcart', {
        specIndex: this.data.selectedSpec,
        specName: this.data.specName,
        quantity: this.data.currentQty
      });
    },
    stop() {}
  }
});
