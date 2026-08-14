#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const apiPath = path.join(ROOT, 'miniprogram/utils/api.js');
const BANNER_CACHE_KEY = 'homeBannerCache';
const flushAsync = () => new Promise(resolve => setImmediate(resolve));

function createPage(definition) {
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(update) {
      Object.keys(update).forEach(key => {
        const match = key.match(/^(\w+)\[(\d+)\]\.(\w+)$/);
        if (!match) {
          this.data[key] = update[key];
          return;
        }
        const [, listKey, rawIndex, prop] = match;
        const index = Number(rawIndex);
        if (this.data[listKey] && this.data[listKey][index]) {
          this.data[listKey][index][prop] = update[key];
        }
      });
    }
  });
}

function loadPage(relativePath, api, storage, wxOverrides) {
  const pagePath = path.join(ROOT, relativePath);
  let definition;
  const originalPage = global.Page;
  const cachedApi = require.cache[apiPath];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };
  global.Page = value => { definition = value; };
  global.wx = Object.assign({
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; },
    stopPullDownRefresh: () => {}, navigateTo: () => {}, showModal: () => {}, showToast: () => {}
  }, wxOverrides || {});
  global.getApp = () => ({ globalData: {}, getReferrer: () => '' });
  delete require.cache[pagePath];
  require(pagePath);
  if (cachedApi) require.cache[apiPath] = cachedApi;
  else delete require.cache[apiPath];
  global.Page = originalPage;
  return createPage(definition);
}

async function testHomeBannerCache() {
  const storage = {};
  const calls = { product: 0, banner: 0 };
  let tempUrlCalls = 0;
  let downloadCalls = 0;
  const wxOverrides = {
    cloud: {
      getTempFileURL: ({ fileList, success }) => {
        tempUrlCalls++;
        success({ fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://cdn.example.test/banner.png' })) });
      },
      downloadFile: ({ fileID, success }) => {
        downloadCalls++;
        success({ tempFilePath: `wxfile://${fileID.split('/').pop()}` });
      }
    }
  };
  let resolveBanner;
  const api = {
    getProductList: async () => {
      calls.product++;
      return { success: true, data: [{ _id: 'p1' }] };
    },
    getBannerList: () => {
      calls.banner++;
      return new Promise(resolve => { resolveBanner = resolve; });
    }
  };
  const home = loadPage('miniprogram/pages/index/index.js', api, storage, wxOverrides);
  await home.onLoad();
  assert.equal(calls.product, 1, 'cold load calls product:list');
  assert.equal(calls.banner, 1, 'cold load calls public banner:list');
  assert.equal(home.data.products.length, 1, 'product loading does not await Banner');
  resolveBanner({ success: true, data: [{ _id: 'b1', imageUrl: 'cloud://env/banner.png', title: '', linkUrl: '' }] });
  await home._bannerPromise;
  assert.equal(home.data.banners.length, 1);
  assert.equal(home.data.banners[0].imageUrl, 'wxfile://banner.png', 'cloud file ID downloads to a local display path');
  assert.equal(home.data.banners[0]._imageFileID, 'cloud://env/banner.png', 'cloud file ID is retained for image load fallback');
  assert.equal(tempUrlCalls, 0, 'fresh Banner response prefers local cloud download before temporary URL');
  home.onBannerImageError({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(downloadCalls, 2, 'image error retries cloud file local download');
  assert.equal(home.data.banners[0].imageUrl, 'wxfile://banner.png', 'image error swaps Banner to local temp file');
  assert.equal(storage[BANNER_CACHE_KEY].banners.length, 1, 'valid response is cached');

  const cachedApi = {
    getProductList: api.getProductList,
    getBannerList: async () => {
      calls.banner++;
      return { success: true, data: [{ _id: 'b1', imageUrl: 'https://temp.example.test/banner.png', title: '', linkUrl: '' }] };
    }
  };
  const freshHome = loadPage('miniprogram/pages/index/index.js', cachedApi, storage, wxOverrides);
  await freshHome.onLoad();
  await freshHome._bannerPromise;
  await flushAsync();
  assert.equal(calls.product, 2, 'fresh cache does not suppress product request');
  assert.equal(calls.banner, 2, 'fresh cloud cache still refreshes Banner request');
  assert.equal(freshHome.data.banners.length, 1, 'fresh cache is displayed while refresh completes');
  assert.equal(freshHome.data.banners[0].imageUrl, 'https://temp.example.test/banner.png', 'cloud cache refresh stores renderable URL');
  assert.equal(tempUrlCalls, 0, 'fresh cache prefers local cloud download before temporary URL');

  storage[BANNER_CACHE_KEY].timestamp = Date.now() - 6 * 60 * 1000;
  let refreshStops = 0;
  const refreshApi = {
    getProductList: api.getProductList,
    getBannerList: async () => {
      calls.banner++;
      return { success: false, error: 'unavailable' };
    }
  };
  const staleHome = loadPage('miniprogram/pages/index/index.js', refreshApi, storage, {
    ...wxOverrides,
    stopPullDownRefresh: () => { refreshStops++; }
  });
  await staleHome.onLoad();
  await staleHome._bannerPromise;
  assert.equal(calls.banner, 3, 'stale cache starts an independent refresh');
  assert.equal(staleHome.data.banners.length, 1, 'failed stale refresh retains cache');
  assert.equal(staleHome.data.loadError, '', 'banner failure never sets product error');
  await staleHome.onPullDownRefresh();
  assert.equal(calls.banner, 4, 'pull refresh forces Banner refresh');
  assert.equal(refreshStops, 1, 'pull refresh settles');
}

async function testSearchHotKeywords() {
  const storage = {};
  const api = {
    getCategoryList: async () => ({ success: true, data: [{ name: '分类一' }] }),
    getHotKeywords: async () => ({ success: true, data: ['热词一'] })
  };
  const search = loadPage('miniprogram/pages/search/search.js', api, storage);
  await search.loadHot();
  assert.deepEqual(search.data.hotKeywords, ['热词一']);
}

async function testUserCenterCache() {
  const realNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    const storage = {
      openId: 'user-1',
      userInfo: { nickName: '用户一', avatarUrl: '/avatar.png' }
    };
    const calls = { agent: 0, counts: 0, oldOrderList: 0, admin: 0 };
    const api = {
      getAgentInfo: async () => {
        calls.agent++;
        return { success: true, isAgent: true };
      },
      getOrderCounts: async () => {
        calls.counts++;
        return { success: true, data: { pending: 1, paid: 2, shipped: 3, refunding: 4 } };
      },
      getOrderList: async () => {
        calls.oldOrderList++;
        return { success: true, total: 99 };
      }
    };
    const user = loadPage('miniprogram/pages/user/user.js', api, storage, {
      cloud: {
        callFunction: async () => {
          calls.admin++;
          return { result: { success: true } };
        }
      }
    });

    await Promise.all([user.loadUserInfo(), user.loadOrderCounts()]);
    assert.equal(calls.agent, 1, 'user center loads agent info once on cold entry');
    assert.equal(calls.counts, 1, 'user center uses aggregate order counts on cold entry');
    assert.equal(calls.oldOrderList, 0, 'user center no longer fans out to order:list for counts');
    assert.deepEqual(user.data.orderCounts, { pending: 1, paid: 2, shipped: 3, refunding: 4 });

    await Promise.all([user.loadUserInfo(), user.loadOrderCounts()]);
    assert.equal(calls.agent, 1, 'agent info is reused from cache inside ttl');
    assert.equal(calls.counts, 1, 'order counts are reused from 30s cache');

    now += 31000;
    await user.loadOrderCounts();
    assert.equal(calls.counts, 2, 'order counts refresh after 30s cache expires');
    assert.equal(calls.agent, 1, 'agent info cache is independent from order count refresh');
  } finally {
    Date.now = realNow;
  }
}

async function testCartPageCache() {
  const realNow = Date.now;
  let now = 2000000;
  Date.now = () => now;
  try {
    const storage = { openId: 'user-cart-1' };
    let stopRefreshCount = 0;
    const responses = [
      { success: true, items: [{ productId: 'p1', name: '商品一', spec: '默认', price: 1200, quantity: 1, image: '' }] },
      { success: true, items: [{ productId: 'p1', name: '商品一更新', spec: '默认', price: 1300, quantity: 1, image: '' }] },
      { success: true, items: [{ productId: 'p2', name: '商品二', spec: '', price: 900, quantity: 2, image: '' }] },
      { success: true, items: [{ productId: 'p2', name: '商品二刷新', spec: '', price: 900, quantity: 2, image: '' }] }
    ];
    const calls = { getCart: 0, updateCart: 0 };
    const api = {
      getCart: async () => {
        calls.getCart++;
        return responses.shift();
      },
      updateCart: async () => {
        calls.updateCart++;
        return { success: true };
      }
    };
    const cart = loadPage('miniprogram/pages/cart/cart.js', api, storage, {
      stopPullDownRefresh: () => { stopRefreshCount++; }
    });

    await cart.loadCart();
    assert.equal(calls.getCart, 1, 'cart cold load fetches cloud once');
    assert.equal(cart.data.cartItems[0].name, '商品一');

    await cart.loadCart();
    assert.equal(calls.getCart, 2, 'cart warm load displays cache and refreshes in background');
    assert.equal(cart.data.cartItems[0].name, '商品一更新', 'cart warm refresh updates visible data');

    now += 31000;
    await cart.loadCart();
    assert.equal(calls.getCart, 3, 'cart cache expires after 30s');
    assert.equal(cart.data.cartItems[0].productId, 'p2');

    await cart.onPullDownRefresh();
    await flushAsync();
    assert.equal(stopRefreshCount, 1, 'cart pull refresh settles');

    cart.data.cartItems = [{ productId: 'p3', name: '本地商品', spec: '', price: 500, quantity: 1, image: '' }];
    await cart.deleteItem({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(calls.updateCart, 1, 'cart mutation syncs cloud');
    assert.equal(storage['cartCache_user-cart-1'].items.length, 0, 'cart mutation updates local cache');
  } finally {
    Date.now = realNow;
  }
}

Promise.resolve()
  .then(testHomeBannerCache)
  .then(testSearchHotKeywords)
  .then(testUserCenterCache)
  .then(testCartPageCache)
  .then(() => console.log('page load logic tests passed'))
  .catch(err => { console.error(err.stack || err); process.exitCode = 1; });
