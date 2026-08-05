const API = require('../../utils/api');
const { toast, showLoading, hideLoading, decorateList } = require('../../utils/util');

// 简易云函数调用(直连 wx.cloud.callFunction)
const cloudCall = (name, data, opts = {}) => {
  return new Promise((resolve) => {
    wx.cloud.callFunction({ name, data, ...opts })
      .then(res => resolve(res.result || {}))
      .catch(err => resolve({ success: false, error: err.errMsg || '调用失败' }));
  });
};

Page({
  data: {
    activeTab: 'product',

    // ===== 商品 =====
    products: [],
    filteredProducts: [],
    productStats: { total: 0, on: 0, off: 0 },
    productKeyword: '',
    productFilterOptions: [
      { key: 'all', label: '全部' },
      { key: 'on', label: '已上架' },
      { key: 'off', label: '已下架' },
      { key: 'lowstock', label: '库存 < 10' }
    ],
    productFilterIndex: 0,
    selectedProductIds: [],
    productLoading: false,
    productLoadError: '',

    // 商品表单
    showProductForm: false,
    editingProductId: '',
    productFormSaving: false,
    productForm: {
      name: '',
      subtitle: '',
      priceYuan: '',
      originalPriceYuan: '',
      stock: '',
      category: '',
      specs: [{ name: '', stock: '' }],
      images: [],
      description: '',
      status: 'on'
    },
    editorCtx: null,

    // ===== 轮播图 =====
    banners: [],
    bannerLoading: false,
    bannerLoadError: '',
    bannerDirty: false,

    showBannerForm: false,
    editingBannerId: '',
    bannerFormSaving: false,
    bannerForm: {
      imageUrl: '',
      title: '',
      linkUrl: '',
      sort: 0,
      status: 'on'
    },

    // 拖拽
    dragIndex: -1
  },

  onLoad() {
    this.loadProducts();
  },

  onShow() {
    // 切换 tab 时刷新
    if (this.data.activeTab === 'product' && this.data.products.length === 0) this.loadProducts();
    if (this.data.activeTab === 'banner' && this.data.banners.length === 0) this.loadBanners();
  },

  onPullDownRefresh() {
    const fn = this.data.activeTab === 'product' ? this.loadProducts : this.loadBanners;
    fn().finally(() => wx.stopPullDownRefresh());
  },

  // =================== Tab ===================
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'product') this.loadProducts();
    if (tab === 'banner') this.loadBanners();
  },

  noop() {},

  // =================== 商品 - 列表 ===================
  async loadProducts() {
    this.setData({ productLoading: true, productLoadError: '' });
    const res = await cloudCall('admin', { action: 'productList' });
    if (res && res.success) {
      const list = decorateList(res.data || []);
      const stats = {
        total: list.length,
        on: list.filter(p => p.status === 'on').length,
        off: list.filter(p => p.status === 'off').length
      };
      this.setData({ products: list, productStats: stats });
      this.applyProductFilter();
      this.setData({ productLoading: false });
    } else {
      this.setData({ productLoading: false, productLoadError: (res && res.error) || '加载失败' });
    }
  },

  onProductKeywordInput(e) {
    this.setData({ productKeyword: e.detail.value });
    this.applyProductFilter();
  },

  clearProductKeyword() {
    this.setData({ productKeyword: '' });
    this.applyProductFilter();
  },

  onProductFilterChange(e) {
    this.setData({ productFilterIndex: Number(e.detail.value) });
    this.applyProductFilter();
  },

  applyProductFilter() {
    const { products, productKeyword, productFilterIndex, productFilterOptions } = this.data;
    const filter = productFilterOptions[productFilterIndex];
    const kw = productKeyword.trim().toLowerCase();
    const filtered = products.filter(p => {
      if (kw && !(p.name || '').toLowerCase().includes(kw)) return false;
      if (filter.key === 'on' && p.status !== 'on') return false;
      if (filter.key === 'off' && p.status !== 'off') return false;
      if (filter.key === 'lowstock' && (p.stock || 0) >= 10) return false;
      return true;
    });
    this.setData({ filteredProducts: filtered });
  },

  onProductTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.selectedProductIds.length > 0) {
      this.toggleProductSelection(e);
      return;
    }
    const p = this.data.products.find(x => x._id === id);
    if (!p) return;
    // 编辑商品
    this.fillProductForm(p);
  },

  toggleProductSelection(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const ids = [...this.data.selectedProductIds];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    this.setData({ selectedProductIds: ids });
  },

  clearProductSelection() {
    this.setData({ selectedProductIds: [] });
  },

  async batchToggleProduct(e) {
    const status = e.currentTarget.dataset.status;
    const ids = [...this.data.selectedProductIds];
    if (ids.length === 0) return;
    showLoading(status === 'on' ? '上架中...' : '下架中...');
    let ok = 0, fail = 0;
    for (const id of ids) {
      const res = await cloudCall('admin', { action: 'toggleProductStatus', id, status });
      if (res && res.success) ok++;
      else fail++;
    }
    hideLoading();
    toast(`成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}`, fail ? 'none' : 'success');
    this.setData({ selectedProductIds: [] });
    this.loadProducts();
  },

  // =================== 商品 - 表单 ===================
  showProductForm() {
    this.fillProductForm(null);
  },

  fillProductForm(p) {
    const isEdit = !!p;
    const form = isEdit ? {
      name: p.name || '',
      subtitle: p.subtitle || '',
      priceYuan: ((p.price || 0) / 100).toFixed(2),
      originalPriceYuan: ((p.originalPrice || 0) / 100).toFixed(2),
      stock: p.stock != null ? String(p.stock) : '',
      category: p.category || '',
      specs: (p.specs && p.specs.length > 0)
        ? p.specs.map(s => ({ name: s.name || '', stock: s.stock != null ? String(s.stock) : '' }))
        : [{ name: '', stock: '' }],
      images: Array.isArray(p.images) ? [...p.images] : [],
      description: p.description || '',
      status: p.status || 'on'
    } : {
      name: '',
      subtitle: '',
      priceYuan: '',
      originalPriceYuan: '',
      stock: '',
      category: '',
      specs: [{ name: '', stock: '' }],
      images: [],
      description: '',
      status: 'on'
    };
    this.setData({
      showProductForm: true,
      editingProductId: isEdit ? p._id : '',
      productForm: form
    });
    // 富文本内容延迟到 ready 后填
    if (isEdit && this.data.editorCtx) {
      setTimeout(() => {
        this.data.editorCtx.setContents({ html: form.description || '', success: () => {} });
      }, 100);
    } else if (!isEdit && this.data.editorCtx) {
      this.data.editorCtx.clear();
    }
  },

  hideProductForm() {
    this.setData({ showProductForm: false, editingProductId: '' });
  },

  onProductFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.currentTarget.dataset.value !== undefined ? e.currentTarget.dataset.value : e.detail.value;
    const form = { ...this.data.productForm };
    form[field] = value;
    this.setData({ productForm: form });
  },

  onSpecInput(e) {
    const { field, index } = e.currentTarget.dataset;
    const value = e.detail.value;
    const specs = this.data.productForm.specs.map((s, i) => i === Number(index) ? { ...s, [field]: value } : s);
    this.setData({ 'productForm.specs': specs });
  },

  addSpec() {
    const specs = [...this.data.productForm.specs, { name: '', stock: '' }];
    this.setData({ 'productForm.specs': specs });
  },

  removeSpec(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const specs = [...this.data.productForm.specs];
    specs.splice(idx, 1);
    this.setData({ 'productForm.specs': specs.length === 0 ? [{ name: '', stock: '' }] : specs });
  },

  // =================== 商品 - 图片 ===================
  chooseProductImages() {
    const remain = 9 - this.data.productForm.images.length;
    if (remain <= 0) { toast('最多 9 张图片'); return; }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const files = res.tempFiles || [];
        showLoading('上传中...');
        const uploaded = [];
        for (const f of files) {
          const r = await this.uploadToCloud(f.tempFilePath);
          if (r) uploaded.push(r);
        }
        hideLoading();
        if (uploaded.length === 0) { toast('上传失败'); return; }
        const images = [...this.data.productForm.images, ...uploaded];
        this.setData({ 'productForm.images': images });
        toast(`已上传 ${uploaded.length} 张`, 'success');
      }
    });
  },

  uploadToCloud(tempPath) {
    // 路径: shop/products/<timestamp>-<random>.jpg
    const ext = (tempPath.match(/\.(\w+)$/) || [, 'jpg'])[1];
    const path = `shop/products/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
    return new Promise((resolve) => {
      wx.cloud.uploadFile({
        cloudPath: path,
        filePath: tempPath,
        success: (res) => resolve(res.fileID),
        fail: () => resolve('')
      });
    });
  },

  removeProductImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = [...this.data.productForm.images];
    images.splice(idx, 1);
    this.setData({ 'productForm.images': images });
  },

  moveProductImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const dir = e.currentTarget.dataset.dir;
    const images = [...this.data.productForm.images];
    const swap = dir === 'left' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= images.length) return;
    [images[idx], images[swap]] = [images[swap], images[idx]];
    this.setData({ 'productForm.images': images });
  },

  // =================== 商品 - 富文本 ===================
  onEditorReady() {
    const ctx = wx.createSelectorQuery().select('#product-desc-editor').context();
    ctx.exec((res) => {
      if (res && res[0]) this.setData({ editorCtx: res[0] });
    });
  },

  onEditorInput(e) {
    this.setData({ 'productForm.description': e.detail.html || '' });
  },

  formatEditor(e) {
    if (!this.data.editorCtx) return;
    const cmd = e.currentTarget.dataset.cmd;
    this.data.editorCtx.format(cmd);
  },

  insertEditorImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: async (res) => {
        const f = (res.tempFiles || [])[0];
        if (!f) return;
        showLoading('上传中...');
        const fileID = await this.uploadToCloud(f.tempFilePath);
        hideLoading();
        if (fileID && this.data.editorCtx) {
          this.data.editorCtx.insertImage({ src: fileID, success: () => {} });
        } else {
          toast('上传失败');
        }
      }
    });
  },

  clearEditor() {
    if (this.data.editorCtx) this.data.editorCtx.clear();
  },

  // =================== 商品 - 保存 ===================
  async saveProduct() {
    const form = this.data.productForm;
    if (!form.name.trim()) { toast('请填写商品名称'); return; }
    const priceYuan = parseFloat(form.priceYuan);
    if (isNaN(priceYuan) || priceYuan < 0) { toast('请填写正确的售价'); return; }
    if (form.images.length === 0) { toast('请至少上传一张商品图'); return; }

    const payload = {
      name: form.name.trim(),
      subtitle: form.subtitle.trim(),
      price: Math.round(priceYuan * 100),
      originalPrice: form.originalPriceYuan ? Math.round(parseFloat(form.originalPriceYuan) * 100) : 0,
      stock: Number(form.stock) || 0,
      category: form.category.trim(),
      specs: form.specs.filter(s => s.name && s.name.trim())
        .map(s => ({ name: s.name.trim(), stock: Number(s.stock) || 0 })),
      images: form.images,
      description: form.description,
      status: form.status
    };
    if (payload.specs.length === 0) payload.specs = [{ name: '默认规格', stock: payload.stock }];

    this.setData({ productFormSaving: true });
    let res;
    if (this.data.editingProductId) {
      res = await cloudCall('admin', { action: 'updateProduct', id: this.data.editingProductId, ...payload });
    } else {
      res = await cloudCall('admin', { action: 'createProduct', ...payload });
    }
    this.setData({ productFormSaving: false });

    if (res && res.success) {
      toast(this.data.editingProductId ? '已保存' : '已创建', 'success');
      this.hideProductForm();
      this.loadProducts();
    } else {
      toast((res && res.error) || '保存失败');
    }
  },

  // =================== 轮播图 - 列表 ===================
  async loadBanners() {
    this.setData({ bannerLoading: true, bannerLoadError: '' });
    const res = await cloudCall('admin', { action: 'bannerList' });
    if (res && res.success) {
      this.setData({ banners: res.data || [], bannerLoading: false, bannerDirty: false });
    } else {
      this.setData({ bannerLoading: false, bannerLoadError: (res && res.error) || '加载失败' });
    }
  },

  async toggleBanner(e) {
    const id = e.currentTarget.dataset.id;
    const bn = this.data.banners.find(x => x._id === id);
    if (!bn) return;
    const next = bn.status === 'on' ? 'off' : 'on';
    const res = await cloudCall('admin', { action: 'toggleBanner', id, status: next });
    if (res && res.success) {
      toast(next === 'on' ? '已启用' : '已禁用', 'success');
      this.loadBanners();
    } else {
      toast((res && res.error) || '操作失败');
    }
  },

  deleteBanner(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除轮播图',
      content: '确认要删除这张轮播图吗？删除后无法恢复。',
      success: async (r) => {
        if (!r.confirm) return;
        const res = await cloudCall('admin', { action: 'deleteBanner', id });
        if (res && res.success) {
          toast('已删除', 'success');
          this.loadBanners();
        } else {
          toast((res && res.error) || '删除失败');
        }
      }
    });
  },

  // 拖拽排序
  onBannerLongPress(e) {
    this.setData({ dragIndex: e.currentTarget.dataset.index });
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
  },

  onBannerTouchStart(e) {
    this._touchStartY = e.touches[0].clientY;
    this._touchStartIndex = e.currentTarget.dataset.index;
  },

  onBannerTouchMove(e) {
    if (this.data.dragIndex < 0) return;
    const y = e.touches[0].clientY;
    const dy = y - (this._touchStartY || 0);
    if (Math.abs(dy) < 30) return;
    const direction = dy > 0 ? 1 : -1;
    const target = this._touchStartIndex + direction;
    if (target < 0 || target >= this.data.banners.length) return;
    const banners = [...this.data.banners];
    [banners[this._touchStartIndex], banners[target]] = [banners[target], banners[this._touchStartIndex]];
    this.setData({ banners, bannerDirty: true, dragIndex: target });
    this._touchStartY = y;
    this._touchStartIndex = target;
  },

  onBannerTouchEnd() {
    this.setData({ dragIndex: -1 });
    this._touchStartY = 0;
    this._touchStartIndex = -1;
  },

  async saveBannerSort() {
    const banners = this.data.banners;
    showLoading('保存排序...');
    let ok = 0, fail = 0;
    for (let i = 0; i < banners.length; i++) {
      const sort = (i + 1) * 10;
      const res = await cloudCall('admin', { action: 'updateBanner', id: banners[i]._id, sort });
      if (res && res.success) ok++; else fail++;
    }
    hideLoading();
    toast(fail ? `保存完成:成功 ${ok} 失败 ${fail}` : '排序已保存', fail ? 'none' : 'success');
    this.loadBanners();
  },

  // =================== 轮播图 - 表单 ===================
  showBannerForm(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id;
    if (id) {
      const bn = this.data.banners.find(x => x._id === id);
      if (!bn) return;
      this.setData({
        showBannerForm: true,
        editingBannerId: id,
        bannerForm: {
          imageUrl: bn.imageUrl || '',
          title: bn.title || '',
          linkUrl: bn.linkUrl || '',
          sort: bn.sort != null ? String(bn.sort) : '0',
          status: bn.status || 'on'
        }
      });
    } else {
      // 新增:默认 sort = 当前数量 + 1
      this.setData({
        showBannerForm: true,
        editingBannerId: '',
        bannerForm: {
          imageUrl: '',
          title: '',
          linkUrl: '',
          sort: String((this.data.banners.length + 1) * 10),
          status: 'on'
        }
      });
    }
  },

  hideBannerForm() {
    this.setData({ showBannerForm: false, editingBannerId: '' });
  },

  onBannerFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.currentTarget.dataset.value !== undefined ? e.currentTarget.dataset.value : e.detail.value;
    this.setData({ ['bannerForm.' + field]: value });
  },

  chooseBannerImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const f = (res.tempFiles || [])[0];
        if (!f) return;
        showLoading('上传中...');
        const fileID = await this.uploadToCloud(f.tempFilePath);
        hideLoading();
        if (fileID) {
          this.setData({ 'bannerForm.imageUrl': fileID });
          toast('上传成功', 'success');
        } else {
          toast('上传失败');
        }
      }
    });
  },

  clearBannerImage() {
    this.setData({ 'bannerForm.imageUrl': '' });
  },

  async saveBanner() {
    const form = this.data.bannerForm;
    if (!form.imageUrl) { toast('请上传轮播图'); return; }
    const payload = {
      imageUrl: form.imageUrl,
      title: (form.title || '').trim(),
      linkUrl: (form.linkUrl || '').trim(),
      sort: Number(form.sort) || 0,
      status: form.status
    };
    this.setData({ bannerFormSaving: true });
    let res;
    if (this.data.editingBannerId) {
      res = await cloudCall('admin', { action: 'updateBanner', id: this.data.editingBannerId, ...payload });
    } else {
      res = await cloudCall('admin', { action: 'createBanner', ...payload });
    }
    this.setData({ bannerFormSaving: false });
    if (res && res.success) {
      toast(this.data.editingBannerId ? '已保存' : '已创建', 'success');
      this.hideBannerForm();
      this.loadBanners();
    } else {
      toast((res && res.error) || '保存失败');
    }
  }
});
