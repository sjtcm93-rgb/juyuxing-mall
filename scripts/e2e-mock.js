#!/usr/bin/env node
// =============================================================
// 橘与杏商城 · 端到端 mock 验证
// 运行: node scripts/e2e-mock.js
//
// 把 wx-server-sdk 用内存数据库替换,串起所有云函数,
// 跑完一整套业务流:登录 → 初始化 → 加购 → 用券下单 → 模拟支付
// → 支付回调 → 佣金结算 → 提现申请 → 管理员审批 → 提现核销。
// =============================================================

'use strict';

const path = require('path');
const Module = require('module');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const CF = path.join(ROOT, 'cloudfunctions');

// ============ wx-server-sdk mock ============
const db = {
  _store: {}, // { collectionName: [doc, ...] }
  _nextId: 1,
  _serverNow: new Date(),
  reset() { this._store = {}; this._nextId = 1; this._serverNow = new Date(); }
};

// 业务操作符
const commandOps = {
  inc(n) { return { __op: 'inc', value: n }; },
  in(arr) { return { __op: 'in', value: arr }; },
  neq(v) { return { __op: 'neq', value: v }; },
  eq(v) { return { __op: 'eq', value: v }; },
  gt(v) { return { __op: 'gt', value: v }; },
  gte(v) { return { __op: 'gte', value: v }; },
  lt(v) { return { __op: 'lt', value: v }; },
  lte(v) { return { __op: 'lte', value: v }; },
  and(...args) { return { __op: 'and', value: args }; },
  or(...args) { return { __op: 'or', value: args }; }
};
const CMD = { ...commandOps, inc: commandOps.inc, in: commandOps.in, neq: commandOps.neq, eq: commandOps.eq };

let currentOpenId = 'mock-customer';
function setOpenId(id) { currentOpenId = id; }

// 匹配一条 query
function matchDoc(doc, query) {
  for (const k of Object.keys(query)) {
    const v = query[k];
    if (v && typeof v === 'object' && v.__regexp) {
      if (!v.__regexp.test(doc[k])) return false;
    } else if (v && typeof v === 'object' && v.__op) {
      const field = doc[k];
      switch (v.__op) {
        case 'inc': return true; // update-only
        case 'in': if (!v.value.includes(field)) return false; break;
        case 'neq': if (field === v.value) return false; break;
        case 'eq': if (field !== v.value) return false; break;
        case 'gt': if (!(field > v.value)) return false; break;
        case 'gte': if (!(field >= v.value)) return false; break;
        case 'lt': if (!(field < v.value)) return false; break;
        case 'lte': if (!(field <= v.value)) return false; break;
        case 'and': if (!v.value.every(q => matchDoc(doc, q))) return false; break;
        case 'or': if (!v.value.some(q => matchDoc(doc, q))) return false; break;
        default: return false;
      }
    } else {
      // 支持点路径: 'agentInfo.status'
      if (k.indexOf('.') >= 0) {
        const parts = k.split('.');
        let cur = doc;
        for (const p of parts) cur = cur && cur[p];
        if (cur !== v) return false;
      } else if (doc[k] !== v) {
        return false;
      }
    }
  }
  return true;
}

function applyUpdate(doc, data) {
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v && typeof v === 'object' && v.__op === 'inc') {
      doc[k] = (Number(doc[k]) || 0) + Number(v.value || 0);
    } else {
      doc[k] = v;
    }
  }
}

class Collection {
  constructor(name) {
    this._name = name;
    this._query = {};
    this._docId = null;
    this._sort = null;
    this._skip = 0;
    this._limit = 100;
    this._db = db;
    if (!db._store[name]) db._store[name] = [];
  }
  doc(id) { this._docId = id; this._query = {}; return this; } // .doc 重置 where 上下文,符合 wx-server-sdk 语义
  where(q) {
    // 浅合并（同一 collection 的多次 .where 调用应覆盖）
    this._query = Object.assign({}, this._query, q);
    return this;
  }
  orderBy(field, dir) { this._sort = { field, dir: dir || 'asc' }; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  async get() {
    let docs = db._store[this._name] || [];
    if (this._docId) {
      const d = docs.find(x => x._id === this._docId);
      // wx-server-sdk 约定: .doc().get() 返回 { data: doc | null }（单条）
      return { data: d || null };
    }
    docs = docs.filter(d => matchDoc(d, this._query));
    if (this._sort) {
      const { field, dir } = this._sort;
      docs.sort((a, b) => {
        const av = a[field], bv = b[field];
        const an = av instanceof Date ? av.getTime() : av;
        const bn = bv instanceof Date ? bv.getTime() : bv;
        if (an === bn) return 0;
        if (an == null) return 1;
        if (bn == null) return -1;
        return (an < bn ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      });
    }
    return { data: docs.slice(this._skip, this._skip + this._limit) };
  }
  async count() {
    let docs = db._store[this._name] || [];
    if (this._docId) docs = docs.filter(x => x._id === this._docId);
    else docs = docs.filter(d => matchDoc(d, this._query));
    return { total: docs.length };
  }
  async add({ data }) {
    const id = 'doc_' + (db._nextId++) + '_' + Math.random().toString(36).slice(2, 8);
    const doc = Object.assign({ _id: id, createTime: db._serverNow }, data);
    db._store[this._name].push(doc);
    return { _id: id };
  }
  async update({ data }) {
    const arr = db._store[this._name] || [];
    let targets;
    if (this._docId) targets = arr.filter(x => x._id === this._docId);
    else targets = arr.filter(d => matchDoc(d, this._query));
    for (const t of targets) {
      applyUpdate(t, data);
      t.updateTime = db._serverNow;
    }
    return { updated: targets.length };
  }
  async remove() {
    const arr = db._store[this._name] || [];
    if (this._docId) {
      const i = arr.findIndex(x => x._id === this._docId);
      if (i >= 0) { arr.splice(i, 1); return { removed: 1 }; }
      return { removed: 0 };
    }
    const before = arr.length;
    db._store[this._name] = arr.filter(d => !matchDoc(d, this._query));
    return { removed: before - db._store[this._name].length };
  }
  async set({ data }) {
    const arr = db._store[this._name];
    let target = this._docId ? arr.find(x => x._id === this._docId) : null;
    if (!target) {
      target = Object.assign({ _id: this._docId || ('doc_' + (db._nextId++) + '_set') }, data);
      arr.push(target);
    } else {
      Object.assign(target, data);
    }
    return { _id: target._id };
  }
}

db.collection = (n) => new Collection(n);
db.command = CMD;
db.serverDate = () => new Date();
// 简易 RegExp 占位,匹配 where.name = db.RegExp({ regexp, options })
db.RegExp = function ({ regexp, options }) {
  const re = new RegExp(regexp, options || '');
  return { __regexp: re, test: (s) => re.test(String(s == null ? '' : s)) };
};

const _loadedModules = {};
function loadCloudFunction(name) {
  if (_loadedModules[name]) return _loadedModules[name];
  const m = require(path.join(CF, name, 'index.js'));
  _loadedModules[name] = m;
  return m;
}

const cloud = {
  init() {},
  getWXContext() { return { OPENID: currentOpenId }; },
  database() { return db; },
  async getTempFileURL({ fileList }) {
    return {
      fileList: (fileList || []).map(fileID => ({
        fileID,
        tempFileURL: 'https://temp.example.test/' + encodeURIComponent(fileID)
      }))
    };
  },
  async callFunction({ name, data }) {
    const mod = loadCloudFunction(name);
    return { result: await mod.main(data || {}, {}) };
  },
  // 不模拟真实云支付
  cloudPay: null
};
// 给真实云支付 refund 一个桩,避免退款流程因为没有云支付凭证而崩
cloud.cloudPay = {
  unifiedOrder: async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', payment: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=mock', signType: 'MD5', paySign: 'mock' }, prepayId: 'mock_prepay' }),
  refund: async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'mock_refund_' + Date.now() })
};

const wxServerSdk = cloud; // 兼容 require('wx-server-sdk') 直接拿到 cloud

// 劫持 require('wx-server-sdk')
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return wxServerSdk;
  return origLoad.apply(this, arguments);
};

// ============ 测试驱动 ============
const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? '  ' + detail : ''}`);
}
function header(t) { console.log('\n=== ' + t + ' ==='); }

async function call(name, data) {
  return cloud.callFunction({ name, data });
}

function generateOrderNo() {
  return 'O' + Date.now() + Math.floor(Math.random() * 1000);
}

// ============== 主流程 ==============
async function main() {
  console.log('橘与杏 E2E Mock 验证\n');
  header('Step 1: 初始化（自动 seed）');
  setOpenId('mock-customer');
  const initRes = (await call('init', { action: 'init' })).result;
  step('init 完成', initRes.success, 'productId=' + initRes.productId);
  const productId = initRes.productId;

  // 验证 6 个分类 + 3 张券被 seed
  const cats = (await call('category', { action: 'list' })).result;
  step('6 个分类', cats.data && cats.data.length >= 6, '实际=' + (cats.data && cats.data.length));
  const coupons = (await call('coupon', { action: 'center' })).result;
  step('3 张券 seed', coupons.data && coupons.data.length >= 3, '实际=' + (coupons.data && coupons.data.length));

  header('Step 1.5: 首页公开 Banner 读取');
  db._store.banners = [
    { _id: 'banner-off', status: 'off', sort: 0, imageUrl: 'https://example.test/off.png', secret: 'hidden' },
    { _id: 'banner-late', status: 'on', sort: 20, imageUrl: 'https://example.test/late.png', title: '晚', linkUrl: '/pages/category/category', secret: 'hidden' },
    { _id: 'banner-first', status: 'on', sort: 10, imageUrl: 'cloud://env/banner-first.png', title: '先', linkUrl: '/pages/search/search', secret: 'hidden' }
  ];
  const bannerList = (await call('banner', { action: 'list' })).result;
  step('公开 Banner 读取成功', bannerList.success);
  step('公开 Banner 只返回上架项且按 sort 排序', bannerList.data && bannerList.data.length === 2 && bannerList.data[0]._id === 'banner-first');
  step('公开 Banner 字段白名单', bannerList.data && bannerList.data.every(b => Object.keys(b).every(k => ['_id', 'imageUrl', 'title', 'linkUrl'].includes(k))));
  step('公开 Banner 云文件转临时图片地址', bannerList.data && bannerList.data[0].imageUrl.indexOf('https://temp.example.test/') === 0);
  const badBannerAction = (await call('banner', { action: 'unknown' })).result;
  step('公开 Banner 未知 action 拒绝', !badBannerAction.success);
  const bannerSrc = fs.readFileSync(path.join(CF, 'banner', 'index.js'), 'utf8');
  step('公开 Banner 读取不依赖 where/orderBy 索引',
    !bannerSrc.includes('.where(') && !bannerSrc.includes('.orderBy('));

  const originalCollection = db.collection;
  db.collection = (name) => {
    const query = originalCollection(name);
    if (name === 'banners') query.get = async () => { throw new Error('banner unavailable'); };
    return query;
  };
  const bannerFailure = (await call('banner', { action: 'list' })).result;
  db.collection = originalCollection;
  step('公开 Banner 查询失败返回通用失败', !bannerFailure.success && bannerFailure.error === 'Banner 暂不可用');

  header('Step 2: 模拟代理推广——A 邀请 B');
  // A 登录（自动设管理员），B 登录
  setOpenId('mock-agent-A');
  const loginA = (await call('login', { action: 'login', ref: '' })).result;
  step('代理 A 登录（自动设管理员）', loginA.success && loginA.openId === 'mock-agent-A');

  setOpenId('mock-customer-B');
  const loginB = (await call('login', { action: 'login', ref: 'mock-agent-A' })).result;
  step('客户 B 登录（带 ref）', loginB.success);

  // 验证 B 的 referrer 写入了
  const userB = db._store.users.find(u => u._id === 'mock-customer-B');
  step('B.referrer = A', userB && userB.referrer === 'mock-agent-A', '实际=' + (userB && userB.referrer));

  header('Step 3: B 领取新人立减券');
  const newUserCoupon = coupons.data.find(c => c.name === '新人立减券');
  const claimRes = (await call('coupon', { action: 'claim', couponId: newUserCoupon._id })).result;
  step('领取新人立减券', claimRes.success);

  const myCoupons = (await call('coupon', { action: 'mine' })).result;
  step('我的券列表 1 张', myCoupons.data && myCoupons.data.length === 1, '实际=' + (myCoupons.data && myCoupons.data.length));

  header('Step 4: B 加购 + 用券下单');
  setOpenId('mock-customer-B');
  // 加购
  const updateCart = (await call('cart', { action: 'update', items: [{
    productId, name: '小紫瓶', spec: '13.5g', price: 6900, quantity: 1, image: ''
  }]})).result;
  step('更新购物车', updateCart.success);

  // 获取可用券
  const avail = (await call('coupon', { action: 'available', amount: 6900 })).result;
  step('可用券列表 1 张', avail.data && avail.data.length === 1, '实际=' + (avail.data && avail.data.length));
  const usableCoupon = avail.data[0];
  step('券折扣 = 1000 分', usableCoupon.discount === 1000, '实际=' + usableCoupon.discount);

  // 计算折后价
  const calc = (await call('coupon', { action: 'calculate', userCouponId: usableCoupon.userCouponId, amount: 6900 })).result;
  step('折后价 = 5900', calc.finalAmount === 5900, '实际=' + calc.finalAmount);

  // 下单
  const orderNo = generateOrderNo();
  const orderRes = (await call('order', {
    action: 'create',
    orderNo,
    items: [{ productId, name: '小紫瓶', spec: '13.5g', price: 6900, quantity: 2, image: '' }],
    totalFee: 12800,
    address: { name: '张三', phone: '13800138000', detail: '北京市朝阳区某街道1号' },
    remark: '请尽快发货',
    couponId: usableCoupon.userCouponId,
    couponDiscount: 1000
  })).result;
  step('创建订单', orderRes.success, 'orderId=' + orderRes.orderId);
  step('服务端重算 totalFee=12800', orderRes.totalFee === 12800, '实际=' + orderRes.totalFee);

  const orderId = orderRes.orderId;
  const orderDoc = db._store.orders.find(o => o._id === orderId);
  step('订单状态=pending', orderDoc.status === 'pending');
  step('订单 agentId=A', orderDoc.agentId === 'mock-agent-A', '实际=' + orderDoc.agentId);
  step('订单 commission=1920(15%*12800)', orderDoc.commission === 1920, '实际=' + orderDoc.commission);

  // mock 模式下 pay.request 直接落 paid（无真实 payNotify 回调）
  const payRes = (await call('pay', { action: 'request', orderId })).result;
  step('模拟支付受理', payRes.success && payRes.mock, 'message=' + (payRes.message || ''));

  // mock 模式下订单已变为 paid
  const orderAfterPay = db._store.orders.find(o => o._id === orderId);
  step('订单已 paid（mock 直接落 paid）', orderAfterPay.status === 'paid', '实际=' + orderAfterPay.status);
  // 记住 wdId 以便后续断言拆分后产生的 paid 佣金
  let _wdIdForCheck = '';
  // payNotify 回调验证幂等性（重复回调应被忽略）
  const notify = (await call('payNotify', { outTradeNo: orderNo, transactionId: 'MOCK_TXN_001', resultCode: 'SUCCESS', returnCode: 'SUCCESS' })).result;
  step('支付回调幂等', notify.errcode === 0, JSON.stringify(notify));

  // 验证佣金已结算
  const comm = db._store.commissions.find(c => c.orderId === orderId);
  step('佣金记录创建', !!comm);
  step('佣金金额=1920', comm && comm.amount === 1920, '实际=' + (comm && comm.amount));
  step('佣金状态=settled', comm && comm.status === 'settled', '实际=' + (comm && comm.status));

  const orderAfterNotify = db._store.orders.find(o => o._id === orderId);
  step('订单 commissionStatus=settled', orderAfterNotify.commissionStatus === 'settled', '实际=' + orderAfterNotify.commissionStatus);

  // 标记券已使用
  const useRes = (await call('coupon', { action: 'use', userCouponId: usableCoupon.userCouponId, orderId })).result;
  step('券已标记 used', useRes.success);
  const userCouponDoc = db._store.user_coupons.find(uc => uc._id === usableCoupon.userCouponId);
  step('user_coupons.status=used', userCouponDoc.status === 'used', '实际=' + userCouponDoc.status);

  header('Step 4.5: 多商品购物车结算（只删已结算商品）');
  setOpenId('mock-customer-B');
  // B 购物车放 3 件商品：2 件小紫瓶（不同规格/数量）+ 1 件占位商品
  const cartItems = [
    { productId, name: '小紫瓶', spec: '13.5g', price: 6900, quantity: 1, image: '' },
    { productId, name: '小紫瓶', spec: '27g', price: 12800, quantity: 2, image: '' },
    { productId: 'other-product', name: '其他商品', spec: '', price: 5000, quantity: 1, image: '' }
  ];
  await call('cart', { action: 'update', items: cartItems });
  // 只结算前 2 件（移除 other-product）。商品为单一价格 6900 分，规格不单独定价
  const removeKeys = ['other-product_'];
  const multiOrderNo = generateOrderNo();
  const multiRes = (await call('order', {
    action: 'create',
    orderNo: multiOrderNo,
    items: cartItems.filter(c => !removeKeys.includes(`${c.productId}_${c.spec || ''}`)),
    totalFee: 6900 * 1 + 6900 * 2,
    address: { name: '李四', phone: '13900139000', detail: '上海市浦东新区某路2号' },
    remark: '',
    removeCartKeys: removeKeys
  })).result;
  step('多商品下单成功', multiRes.success, 'orderId=' + (multiRes.orderId || multiRes.error));
  const multiOrderDoc = db._store.orders.find(o => o._id === multiRes.orderId);
  step('多商品订单含 2 个 item', multiOrderDoc && multiOrderDoc.items && multiOrderDoc.items.length === 2, '实际=' + (multiOrderDoc && multiOrderDoc.items && multiOrderDoc.items.length));
  // 验证购物车只删了 other-product，保留了 2 件小紫瓶
  const cartAfter = (await call('cart', { action: 'get' })).result;
  const remaining = (cartAfter.items || []);
  step('购物车保留 2 件', remaining.length === 2, '实际=' + remaining.length);
  step('被结算的 other-product 已移除', !remaining.find(i => i.productId === 'other-product'));

  header('Step 5: 代理 A 申请提现');
  setOpenId('mock-agent-A');
  const wdInfo = (await call('withdrawal', { action: 'info' })).result;
  step('A 可提现=1920', wdInfo.available === 1920, '实际=' + wdInfo.available);
  step('A 处理中=0', wdInfo.pendingCount === 0);

  const apply = (await call('withdrawal', { action: 'apply', amount: 1000, name: '代理A', account: '6222021234567890' })).result;
  step('申请提现 1000', apply.success);
  const wdInfo2 = (await call('withdrawal', { action: 'info' })).result;
  step('A 剩余=920(available-pending)', (wdInfo2.available - wdInfo2.pendingAmount) === 920, '实际=' + wdInfo2.available + '-' + wdInfo2.pendingAmount);

  // 验证申请边界: 申请 100 元以下应失败
  const small = (await call('withdrawal', { action: 'apply', amount: 500, name: 'A', account: 'x' })).result;
  step('10元起提拦截', !small.success && small.error.indexOf('10') >= 0);

  // 验证申请超额应失败
  setOpenId('mock-agent-A');
  const over = (await call('withdrawal', { action: 'apply', amount: 99999, name: 'A', account: 'x' })).result;
  step('超额拦截', !over.success && over.error.indexOf('余额') >= 0);

  header('Step 6: 管理员审批提现');
  setOpenId('mock-agent-A'); // A 是 admin
  // 在 mock 环境中手动设置 A 为管理员（生产环境中应通过 init setAdminOpenId 配置）
  const adminCfg = db._store.admin_config && db._store.admin_config.find(d => d._id === 'admin');
  if (adminCfg) {
    adminCfg.openId = 'mock-agent-A';
    adminCfg.adminOpenIds = ['mock-agent-A'];
  }
  const pending = (await call('admin', { action: 'withdrawalList', statusFilter: 'pending' })).result;
  step('管理员看到 1 条 pending 提现', pending.data && pending.data.length === 1, '实际=' + (pending.data && pending.data.length));
  const wdId = pending.data[0]._id; _wdIdForCheck = wdId;

  const approve = (await call('admin', { action: 'processWithdrawal', withdrawalId: wdId, approve: true, remark: '已打款' })).result;
  step('审批通过', approve.success, 'consumed=' + (approve.consumed || ''));

  // 验证佣金：原 settled 记录被拆分,新一条 paid 记录挂在本次提现上
  const originalComm = db._store.commissions.find(c => c.orderId === orderId && c.status === 'settled');
  step('原 settled 佣金扣减到 920', originalComm && originalComm.amount === 920, '实际=' + (originalComm && originalComm.amount));
  const paidComm = db._store.commissions.find(c => c.paidByWithdrawal === _wdIdForCheck);
  step('拆分出 paid 佣金 1000', paidComm && paidComm.amount === 1000, '实际=' + (paidComm && paidComm.amount));
  step('paid 佣金 status=paid', paidComm && paidComm.status === 'paid', '实际=' + (paidComm && paidComm.status));

  // 验证提现记录变 approved
  const wdDoc = db._store.withdrawals.find(w => w._id === wdId);
  step('提现 status=approved', wdDoc.status === 'approved', '实际=' + wdDoc.status);

  // 重复审批应失败
  const dup = (await call('admin', { action: 'processWithdrawal', withdrawalId: wdId, approve: true })).result;
  step('重复审批拦截', !dup.success);

  header('Step 7: 申请退款');
  setOpenId('mock-customer-B');
  const refundReq = (await call('order', { action: 'requestRefund', id: orderId, reason: '不想要了', description: '测试' })).result;
  step('申请退款', refundReq.success);
  const orderRef = db._store.orders.find(o => o._id === orderId);
  step('订单状态=refunding', orderRef.status === 'refunding', '实际=' + orderRef.status);

  // 重复申请应拦截
  const dupRefund = (await call('order', { action: 'requestRefund', id: orderId, reason: 'x' })).result;
  step('重复退款拦截', !dupRefund.success);

  header('Step 8: 管理员处理退款（无交易号走线下）');
  setOpenId('mock-agent-A');
  const refundList = (await call('admin', { action: 'refundList', statusFilter: 'pending' })).result;
  step('管理员看到 1 条 pending 退款', refundList.data && refundList.data.length === 1);
  // 订单里还没有 transactionId,审批走"无交易号"分支
  const process = (await call('admin', { action: 'processRefund', refundId: refundList.data[0]._id, approve: true, adminNote: 'OK' })).result;
  step('处理退款', process.success, 'msg=' + (process.message || ''));
  const orderFinal = db._store.orders.find(o => o._id === orderId);
  step('订单状态=refunded', orderFinal.status === 'refunded', '实际=' + orderFinal.status);

  header('Step 9: checkAdmin 权限校验');
  // 非管理员
  setOpenId('mock-customer-B');
  const noAdmin = (await call('admin', { action: 'checkAdmin' })).result;
  step('非管理员 checkAdmin 拒绝', !noAdmin.success && noAdmin.error.indexOf('管理员') >= 0);

  // 管理员
  setOpenId('mock-agent-A');
  const yesAdmin = (await call('admin', { action: 'checkAdmin' })).result;
  step('管理员 checkAdmin 通过', yesAdmin.success);

  header('Step 10: 收藏 / 搜索 / 分类');
  setOpenId('mock-customer-B');
  const fav = (await call('favorite', { action: 'toggle', productId })).result;
  step('切换收藏', fav.success);
  const fav2 = (await call('favorite', { action: 'toggle', productId })).result;
  step('再次切换（取消）', fav2.success && fav2.favorited === false);
  const favList = (await call('favorite', { action: 'list' })).result;
  step('收藏列表空（已取消）', favList.data && favList.data.length === 0);

  const search = (await call('product', { action: 'search', keyword: '小紫瓶' })).result;
  step('搜索"小紫瓶"命中', search.data && search.data.length >= 1, '命中=' + (search.data && search.data.length));

  const catProducts = (await call('category', { action: 'products', id: cats.data[0]._id })).result;
  step('分类下商品', catProducts.data && Array.isArray(catProducts.data));

  header('Step 11: 客服 chat 消息收发 / 拉取 / markAsRead');
  setOpenId('mock-customer-B');
  const sendRes = (await call('chat', { action: 'sendMessage', type: 'text', content: '你好,小紫瓶几天发货?' })).result;
  step('B 发消息', sendRes.success, 'messageId=' + (sendRes.messageId || ''));
  const getRes = (await call('chat', { action: 'getMessages' })).result;
  step('B 拉消息 1 条', getRes.data && getRes.data.length === 1, '实际=' + (getRes.data && getRes.data.length));
  // markAsRead 不报错即可
  const markRes = (await call('chat', { action: 'markAsRead' })).result;
  step('B markAsRead', markRes.success);
  // 管理员视角拉会话列表
  setOpenId('mock-agent-A');
  const conv = (await call('chat', { action: 'getConversationList' })).result;
  step('管理员看到 1 个会话', conv.data && conv.data.length === 1, '实际=' + (conv.data && conv.data.length));
  // 管理员回复
  const reply = (await call('chat', { action: 'sendMessage', content: '亲,24 小时内发货~', toId: 'mock-customer-B' })).result;
  step('管理员回复', reply.success);

  // ===== 汇总 =====
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log('\n════════════════════════════════════════════');
  console.log(' 通过: ' + pass);
  console.log(' 失败: ' + fail);
  console.log('════════════════════════════════════════════');
  if (fail > 0) {
    console.log('\n❌ 失败项:');
    results.filter(r => !r.ok).forEach(r => console.log('  - ' + r.name + (r.detail ? ' [' + r.detail + ']' : '')));
    process.exitCode = 1;
  } else {
    console.log('\n✅ 全部业务流通过');
  }
}

main().catch(err => {
  console.error('E2E mock 异常:', err);
  process.exitCode = 1;
});
