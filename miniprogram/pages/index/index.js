const API = require('../../utils/api');
const { toast } = require('../../utils/util');

const BANNER_CACHE_KEY = 'homeBannerCache';
const BANNER_CACHE_TTL = 5 * 60 * 1000;

function isValidBanner(banner) {
  return !!(banner && typeof banner === 'object' && typeof banner._id === 'string' &&
    typeof banner.imageUrl === 'string' && typeof banner.title === 'string' &&
    typeof banner.linkUrl === 'string');
}

function readBannerCache() {
  try {
    const cache = wx.getStorageSync(BANNER_CACHE_KEY);
    if (!cache || !Number.isFinite(cache.timestamp) || !Array.isArray(cache.banners) ||
      !cache.banners.every(isValidBanner)) return null;
    return cache;
  } catch (err) {
    return null;
  }
}

function writeBannerCache(banners) {
  try {
    wx.setStorageSync(BANNER_CACHE_KEY, { timestamp: Date.now(), banners });
  } catch (err) {}
}

function hasCloudImage(banners) {
  return (banners || []).some(banner =>
    banner && typeof banner.imageUrl === 'string' && banner.imageUrl.indexOf('cloud://') === 0);
}

function resolveBannerImages(banners) {
  const fileIDs = banners
    .map(banner => banner.imageUrl)
    .filter(imageUrl => imageUrl.indexOf('cloud://') === 0);
  if (!fileIDs.length || !wx.cloud) {
    return Promise.resolve(banners);
  }
  const withFileID = banners.map(banner => Object.assign({}, banner, {
    _imageFileID: banner.imageUrl.indexOf('cloud://') === 0 ? banner.imageUrl : ''
  }));
  const applyResolved = (resolved, fallback) => banners.map(banner => Object.assign({}, banner, {
    _imageFileID: banner.imageUrl.indexOf('cloud://') === 0 ? banner.imageUrl : '',
    imageUrl: resolved[banner.imageUrl] || fallback[banner.imageUrl] || banner.imageUrl
  }));
  const download = ids => {
    if (typeof wx.cloud.downloadFile !== 'function') return Promise.resolve({});
    const fallback = {};
    return Promise.all(ids.map(fileID => new Promise(done => {
      wx.cloud.downloadFile({
        fileID,
        success: file => { if (file.tempFilePath) fallback[fileID] = file.tempFilePath; done(); },
        fail: done
      });
    }))).then(() => fallback);
  };
  if (typeof wx.cloud.downloadFile === 'function') {
    return download(fileIDs).then(fallback => {
      const missing = fileIDs.filter(fileID => !fallback[fileID]);
      if (!missing.length || typeof wx.cloud.getTempFileURL !== 'function') {
        return Object.keys(fallback).length ? applyResolved({}, fallback) : withFileID;
      }
      return new Promise(resolve => {
        wx.cloud.getTempFileURL({
          fileList: missing,
          success: res => {
            const resolved = {};
            (res.fileList || []).forEach(file => {
              if (file.fileID && file.tempFileURL) resolved[file.fileID] = file.tempFileURL;
            });
            resolve(applyResolved(resolved, fallback));
          },
          fail: () => resolve(applyResolved({}, fallback))
        });
      });
    });
  }
  if (typeof wx.cloud.getTempFileURL !== 'function') {
    return download(fileIDs).then(fallback => applyResolved({}, fallback));
  }
  return new Promise(resolve => {
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: res => {
        const resolved = {};
        (res.fileList || []).forEach(file => {
          if (file.fileID && file.tempFileURL) resolved[file.fileID] = file.tempFileURL;
        });
        const missing = fileIDs.filter(fileID => !resolved[fileID]);
        if (!missing.length) {
          resolve(applyResolved(resolved, {}));
          return;
        }
        download(missing).then(fallback => resolve(applyResolved(resolved, fallback)));
      },
      fail: () => {
        download(fileIDs).then(fallback => resolve(Object.keys(fallback).length ? applyResolved({}, fallback) : withFileID));
      }
    });
  });
}

Page({
  data: {
    brandChars: ['橘', '与', '杏'],
    products: [],
    banners: [],
    loading: true,
    loadError: '',
    page: 1,
    hasMore: true,
    loadingMore: false,
    _diag: ''  // 诊断信息（开发用）
  },

  onLoad() {
    console.log('[index] onLoad 开始加载...');
    const t0 = Date.now();
    
    const loadPromise = this._loadWithDiag('products', () => this.loadProducts());
    this.loadBanners();
    this.handleReferrer();
    
    console.log('[index] onLoad 发起调用耗时:', Date.now() - t0, 'ms');
    return loadPromise;
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true, loadingMore: false });
    return Promise.all([this.loadProducts(true), this.loadBanners(true)])
      .finally(() => wx.stopPullDownRefresh());
  },

  onShow() {
    return this.loadBanners();
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1, loadingMore: true });
    return this.loadProducts(false, true);
  },

  // ===== 诊断包装器：精确记录哪个调用失败、花了多久 =====
  async _loadWithDiag(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      console.log(`[index] ${name} ✅ 成功, 耗时 ${Date.now() - t0}ms`);
    } catch (err) {
      const msg = err && (err.errMsg || err.message || JSON.stringify(err).substring(0, 200));
      console.error(`[index] ${name} ❌ 失败 (${Date.now() - t0}ms):`, msg);
      console.error(`[index] ${name} 完整错误对象:`, err);
      this.setData({
        loadError: name === 'home' ? '加载失败' : `${name}请求失败: ${msg}`,
        _diag: name === 'home' ? 'home unavailable' : `${name}: ${msg} (${Date.now() - t0}ms)`
      });
    }
  },

  loadBanners(forceRefresh = false) {
    if (this._bannerPromise) return this._bannerPromise;

    const cache = readBannerCache();
    const cacheHasCloudImage = cache && hasCloudImage(cache.banners);
    const cacheIsFresh = cache && Date.now() - cache.timestamp < BANNER_CACHE_TTL && !cacheHasCloudImage;
    const cachedBanners = cache && !cacheHasCloudImage
      ? resolveBannerImages(cache.banners).then(banners => {
        this.setData({ banners });
        return banners;
      })
      : Promise.resolve([]);
    if (!forceRefresh && cacheIsFresh) return cachedBanners;

    this._bannerPromise = API.getBannerList({ silent: true })
      .then(res => {
        if (!res || !res.success || !Array.isArray(res.data) || !res.data.every(isValidBanner)) {
          throw new Error('invalid banner response');
        }
        writeBannerCache(res.data);
        return resolveBannerImages(res.data).then(banners => {
          this.setData({ banners, _diag: '' });
          return banners;
        });
      })
      .catch(err => {
        console.warn('[index] banner refresh failed:', err && (err.errMsg || err.message || err));
        if (!cache) this.setData({ banners: [], _diag: 'banner unavailable' });
        return cachedBanners;
      })
      .finally(() => { this._bannerPromise = null; });
    return this._bannerPromise;
  },

  onBannerTap(e) {
    const linkUrl = e.currentTarget.dataset.link;
    if (!linkUrl) return;
    if (linkUrl.indexOf('http') === 0) {
      wx.showModal({ title: '提示', content: '即将打开外链：' + linkUrl, showCancel: false });
      return;
    }
    if (linkUrl.indexOf('/pages/') === 0) {
      wx.navigateTo({ url: linkUrl });
    }
  },

  onBannerImageError(e) {
    const index = e.currentTarget.dataset.index;
    const banner = this.data.banners[index];
    if (!banner || !banner._imageFileID || !wx.cloud || typeof wx.cloud.downloadFile !== 'function') return;
    wx.cloud.downloadFile({
      fileID: banner._imageFileID,
      success: res => {
        if (!res.tempFilePath) return;
        this.setData({ [`banners[${index}].imageUrl`]: res.tempFilePath });
      },
      fail: err => {
        console.warn('[index] banner image fallback failed:', err && (err.errMsg || err.message || err));
      }
    });
  },

  handleReferrer() {
    const ref = getApp().getReferrer();
    if (ref) wx.setStorageSync('pendingReferrer', ref);
  },

  async loadProducts(isPullDown = false, isLoadMore = false) {
    if (!isPullDown && !isLoadMore) this.setData({ loading: true, loadError: '' });
    if (isLoadMore) this.setData({ loadingMore: true });
    
    const page = isPullDown ? 1 : (isLoadMore ? this.data.page : 1);
    const res = await API.getProductList({ pageSize: 10, page }).catch(err => {
      console.error('[index] getProductList catch:', err.errMsg || err);
      throw err;
    });
    
    if (res && res.success && res.data) {
      const list = isLoadMore ? this.data.products.concat(res.data) : res.data;
      this.setData({
        products: list,
        loading: false,
        loadingMore: false,
        hasMore: res.data.length >= 10
      });
    } else {
      this.setData({ loading: false, loadingMore: false });
    }
  },

  onGoodsClick(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    wx.navigateTo({ url: `/pages/product/product?id=${goods._id}` });
  },

  onGoodsAction(e) {
    const goods = e.detail.goods;
    if (!goods || !goods._id) return;
    if (!wx.getStorageSync('openId')) {
      toast('请先登录');
      return;
    }
    wx.navigateTo({ url: `/pages/checkout/checkout?productId=${goods._id}&quantity=1` });
  },

  goCategory() { wx.navigateTo({ url: '/pages/category/category' }); },
  goSearch() { wx.navigateTo({ url: '/pages/search/search' }); },
  goFavorites() { wx.navigateTo({ url: '/pages/favorites/favorites' }); },
  goCouponCenter() { wx.navigateTo({ url: '/pages/coupon-center/coupon-center' }); },

  retry() {
    this.setData({ loading: true, loadError: '', _diag: '' });
    this.loadBanners(true);
    return this.loadProducts();
  },

  onShareAppMessage() {
    const openId = wx.getStorageSync('openId');
    return {
      title: '橘与杏中医生活 - 自然疗愈好物',
      path: `/pages/index/index?ref=${openId || ''}`,
      imageUrl: '/images/share-banner.png'
    };
  }
});
