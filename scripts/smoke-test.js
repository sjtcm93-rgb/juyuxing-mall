#!/usr/bin/env node
// =============================================================
// 橘与杏中医生活 — 业务规则 smoke test
// 运行: node scripts/smoke-test.js
//
// 不依赖云开发环境，本地静态检查 + 关键业务规则验证。
// =============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const passes = [];

function ok(name) { passes.push(name); }
function fail(name, reason) { failures.push({ name, reason }); }

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// ---------- 1. 文件结构 ----------
console.log('▶ 静态结构检查');

const required = [
  // 云函数
  'cloudfunctions/init/index.js',
  'cloudfunctions/login/index.js',
  'cloudfunctions/product/index.js',
  'cloudfunctions/cart/index.js',
  'cloudfunctions/order/index.js',
  'cloudfunctions/pay/index.js',
  'cloudfunctions/agent/index.js',
  'cloudfunctions/commission/index.js',
  'cloudfunctions/withdrawal/index.js',
  'cloudfunctions/admin/index.js',
  'cloudfunctions/banner/index.js',
  'cloudfunctions/banner/package.json',
  // 前端页面
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/utils/api.js',
  'miniprogram/utils/cloud.js',
  'miniprogram/utils/util.js',
  'miniprogram/pages/index/index.js',
  'miniprogram/pages/index/index.wxml',
  'miniprogram/pages/product/product.js',
  'miniprogram/pages/cart/cart.js',
  'miniprogram/pages/checkout/checkout.js',
  'miniprogram/pages/order/order.js',
  'miniprogram/pages/order-detail/order-detail.js',
  'miniprogram/pages/user/user.js',
  'miniprogram/pages/agent-center/agent-center.js',
  'miniprogram/pages/agent-join/agent-join.js',
  'miniprogram/pages/address/address.js',
  'miniprogram/pages/address-edit/address-edit.js',
  'miniprogram/pages/logistics/logistics.js',
  'miniprogram/pages/about/about.js',
  'miniprogram/pages/admin/admin.js',
  'miniprogram/pages/withdrawal/withdrawal.js',
  // 配置
  'project.config.json',
  'cloudbaserc.json',
  'database-indexes.json',
];
required.forEach(rel => {
  if (exists(rel)) ok('exists: ' + rel);
  else fail('exists: ' + rel, 'file not found');
});

// 校验 app.json 中注册的每个页面都有 js/wxml/wxss/json 四件套、tabBar 图标存在
const appJson = JSON.parse(read('miniprogram/app.json'));
for (const page of appJson.pages) {
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    const rel = 'miniprogram/' + page + '.' + ext;
    if (exists(rel)) ok('page ' + ext + ': ' + page);
    else fail('page ' + ext, rel + ' 缺失');
  }
}
const tabList = (appJson.tabBar && appJson.tabBar.list) || [];
for (const t of tabList) {
  if (exists('miniprogram/' + t.iconPath)) ok('tabBar icon: ' + t.iconPath);
  else fail('tabBar icon', t.iconPath + ' 缺失');
  if (exists('miniprogram/' + t.selectedIconPath)) ok('tabBar icon (active): ' + t.selectedIconPath);
  else fail('tabBar icon (active)', t.selectedIconPath + ' 缺失');
}

// ---------- 2. 配置正确性 ----------
console.log('▶ 配置正确性');

const projectConfig = JSON.parse(read('project.config.json'));
if (projectConfig.appid && projectConfig.appid !== 'your-app-id') {
  ok('appid 已配置: ' + projectConfig.appid);
} else {
  fail('appid', '尚未填写真实 AppID');
}

const cloudbaserc = JSON.parse(read('cloudbaserc.json'));
if (cloudbaserc.envId && cloudbaserc.envId !== 'your-env-id') {
  ok('云环境 envId: ' + cloudbaserc.envId);
} else {
  fail('envId (cloudbaserc)', '尚未填写');
}

const appJs = read('miniprogram/app.js');
const envIdMatch = appJs.match(/envId:\s*['"]([^'"]+)['"]/);
if (envIdMatch && envIdMatch[1] !== 'your-env-id') {
  ok('app.js envId: ' + envIdMatch[1]);
} else {
  fail('envId (app.js)', '尚未填写');
}

if (projectConfig.appid && cloudbaserc.envId && envIdMatch &&
    projectConfig.appid !== 'your-app-id' &&
    cloudbaserc.envId !== 'your-env-id') {
  ok('AppID 与云环境 ID 一致性已就绪');
}

// ---------- 3. 关键业务规则 ----------
console.log('▶ 关键业务规则');

const orderSrc = read('cloudfunctions/order/index.js');
// 佣金比例：支持硬编码常量（COMMISSION_RATE = 0.15）或动态读取（getCommissionRate 默认 0.15）
const COMMISSION_RATE_MATCH = orderSrc.match(/COMMISSION_RATE\s*=\s*([\d.]+)/);
const DYNAMIC_RATE_MATCH = orderSrc.match(/commissionRate[^\d]*([\d.]+)/);
const rate = COMMISSION_RATE_MATCH ? parseFloat(COMMISSION_RATE_MATCH[1]) : (DYNAMIC_RATE_MATCH ? parseFloat(DYNAMIC_RATE_MATCH[1]) : null);
if (rate === 0.15) ok('佣金比例 = 15%');
else fail('佣金比例', '应为 0.15，实际 ' + rate);

const agentSrc = read('cloudfunctions/agent/index.js');
const codeMatch = agentSrc.match(/code\s*=\s*['"]JY['"]\s*\+\s*OPENID\.substring/);
if (codeMatch) ok('推广码生成规则: JY + OPENID 末 6 位');
else fail('推广码生成', '格式异常，应为 JY + OPENID.substring(...,length-6)');

const withdrawalSrc = read('cloudfunctions/withdrawal/index.js');
const minWdMatch = withdrawalSrc.match(/amount\s*<\s*(\d+)/);
if (minWdMatch && parseInt(minWdMatch[1], 10) === 1000) {
  ok('最低提现金额 = 10 元 (1000 分)');
} else {
  fail('最低提现金额', '应为 1000 分 (10 元)');
}

const initSrc = read('cloudfunctions/init/index.js');
if (initSrc.includes('admin_config')) {
  ok('init 函数会创建 admin_config 文档');
} else {
  fail('admin_config 创建', 'init 函数中未发现 admin_config 创建逻辑');
}

const adminSrc = read('cloudfunctions/admin/index.js');
if (adminSrc.includes("status: 'paid'") &&
    adminSrc.includes('paidByWithdrawal')) {
  ok('admin.processWithdrawal 会消耗 settled 佣金（防重复提现）');
} else {
  fail('admin.processWithdrawal', '未发现消耗 settled 佣金的逻辑');
}

const bannerSrc = read('cloudfunctions/banner/index.js');
const homePageSrc = read('miniprogram/pages/index/index.js');
const userPageSrc = read('miniprogram/pages/user/user.js');
const apiSrc = read('miniprogram/utils/api.js');
const searchSrc = read('miniprogram/pages/search/search.js');
const skeletonSrc = read('miniprogram/components/skeleton/skeleton.wxml');
if (!bannerSrc.includes('admin_config') && !bannerSrc.includes("collection('admin") &&
    bannerSrc.includes("event.action !== 'list'") && bannerSrc.includes("banner.status === 'on'") &&
    bannerSrc.includes('Number(a.sort)') && bannerSrc.includes('.slice(0, 20)')) {
  ok('banner:list 为公开的上架排序读取（无索引依赖）');
} else {
  fail('banner:list 公共边界', '不得读取管理员配置，且必须限制 action/状态并在服务端排序');
}
if (bannerSrc.includes('_id: banner._id') && bannerSrc.includes('imageUrl:') && bannerSrc.includes('title:') && bannerSrc.includes('linkUrl:')) {
  ok('banner:list Banner 字段白名单');
} else {
  fail('banner:list Banner 字段', '必须仅映射公开字段');
}
if (bannerSrc.includes('cloud.getTempFileURL') && bannerSrc.includes("imageUrl.indexOf('cloud://') === 0")) {
  ok('banner:list 云文件图片转临时 URL');
} else {
  fail('banner:list 云文件图片', 'cloud:// 图片必须在云函数返回前转成可渲染 URL');
}
if (apiSrc.includes("getBannerList: (options) => call('banner', { action: 'list' }") &&
    !apiSrc.includes('getHomeFeed:') && homePageSrc.includes('API.getProductList') &&
    homePageSrc.includes('API.getBannerList') && homePageSrc.includes('BANNER_CACHE_TTL')) {
  ok('首页使用独立商品和公开 Banner 缓存');
} else {
  fail('首页独立 Banner 缓存', '首页必须独立加载商品和公开 Banner，不得使用 home/admin 聚合接口');
}
if (apiSrc.includes("getHotKeywords: (options) => call('category', { action: 'hotKeywords' }") &&
    searchSrc.includes('Promise.all([categoryPromise, hotKeywordPromise])') &&
    !searchSrc.includes('wx.cloud.callFunction')) {
  ok('搜索热词走 API 并发加载');
} else {
  fail('搜索热词加载', '应通过 API 并发加载分类和热词');
}
if (!/wx:key="[^"]*\{\{/.test(skeletonSrc) && (skeletonSrc.match(/wx:key="index"/g) || []).length === 3) {
  ok('骨架屏 wx:key 合法');
} else {
  fail('骨架屏 wx:key', '三处静态占位循环必须使用合法 key');
}
if (orderSrc.includes("case 'counts'") && apiSrc.includes("getOrderCounts: (options) => call('order', { action: 'counts' }") &&
    userPageSrc.includes('ORDER_COUNTS_CACHE_TTL = 30 * 1000') && userPageSrc.includes('API.getOrderCounts') &&
    !userPageSrc.includes("API.getOrderList({ status: 'pending'")) {
  ok('我的页订单角标走聚合计数和 30 秒缓存');
} else {
  fail('我的页订单角标', '应使用 order:counts 聚合接口和 30 秒本地缓存，不再四次调用 order:list');
}

const paySrc = read('cloudfunctions/pay/index.js');
// 新设计: pay 不再直改订单状态,真实支付由 payNotify 回调做"落 paid + 写佣金",mock 模式则不落状态等待回调
const payNotifySrc = read('cloudfunctions/payNotify/index.js');
if (paySrc.includes('cloud.cloudPay.unifiedOrder') &&
    paySrc.includes('functionName:') &&
    payNotifySrc.includes('commissions') &&
    payNotifySrc.includes("status: 'paid'")) {
  ok('pay 走云支付下单,payNotify 回调负责落 paid/佣金（链路分离）');
} else {
  fail('pay/payNotify', '未走新的 "pay 统一下单 + payNotify 回调" 设计');
}

// ---------- 4. 关键业务方法单元验证 ----------
console.log('▶ 业务方法单元验证');

// 验证订单号格式
const utilSrc = read('miniprogram/utils/util.js');
// util.js 依赖 wx 全局 toast/showLoading/hideLoading，但纯函数部分（订单号、价格、状态文案）不依赖 wx，
// require 后只用到的这几个都不会调 wx。
const util = require(path.join(ROOT, 'miniprogram/utils/util.js'));

if (typeof util.generateOrderNo === 'function') {
  const orderNo = util.generateOrderNo();
  if (/^JY\d{14}[A-Z0-9]{6}$/.test(orderNo)) ok('订单号格式正确: ' + orderNo);
  else fail('订单号格式', '应为 JY+14位时间戳+6位随机，实际 ' + orderNo);
} else {
  fail('util.generateOrderNo', '函数不存在');
}

if (typeof util.formatPrice === 'function' && typeof util.parsePrice === 'function') {
  const cases = [
    [6900, '69.00', 69],
    [1, '0.01', 0.01],
    [99, '0.99', 0.99],
    [12345, '123.45', 123.45],
  ];
  let allOk = true;
  for (const [cents, str, back] of cases) {
    const got = util.formatPrice(cents);
    const backCents = util.parsePrice(String(back));
    if (got !== str) { allOk = false; break; }
    if (backCents !== cents) { allOk = false; break; }
  }
  if (allOk) ok('价格格式转换双向正确 (分 ↔ 元)');
  else fail('价格转换', '转换结果不符合预期');
}

if (typeof util.getOrderStatusText === 'function') {
  const expected = ['pending', 'paid', 'shipped', 'received', 'cancelled'];
  const allOk = expected.every(s => util.getOrderStatusText(s).length > 0);
  if (allOk) ok('订单状态文案映射完整');
  else fail('订单状态文案', '部分状态缺失');
}

// ---------- 5. 数据流一致性 ----------
console.log('▶ 数据流一致性');

// 验证 order 中 COMMISSION_RATE 与 pay 不再写死 0.15
if (!paySrc.match(/const\s+rate\s*=\s*0\.15/) && !paySrc.match(/rate:\s*0\.15/)) {
  ok('pay 不再硬编码佣金比例 0.15');
} else {
  fail('pay 硬编码', 'pay 中仍存在写死的 0.15，应改用常量或通过 order 统一处理');
}

// 验证 order.updateStatus 中使用佣金比例（常量或动态读取）
if ((orderSrc.includes('COMMISSION_RATE') || orderSrc.includes('getCommissionRate')) && orderSrc.match(/if\s*\(newStatus\s*===\s*['"]paid['"]\)/)) {
  ok('order.updateStatus 佣金创建使用统一比例');
}

// 验证 agent.apply 重复申请防护
if (agentSrc.includes("agentInfo?.status") && agentSrc.includes("'pending'")) {
  ok('agent.apply 已防止重复申请');
}

// ---------- 6. WXS 依赖扫描(避免再次踩 IDE 老编译器坑) ----------
console.log('▶ WXS 静态扫描');

// 扫所有 .wxml,不允许再出现 <wxs> 标签或 f.price() / f.formatTime() / f.statusText() 调用
const pagesDir = path.join(ROOT, 'miniprogram');
const componentsDir = path.join(ROOT, 'miniprogram/components');
const allWxml = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp);
    else if (f.endsWith('.wxml')) allWxml.push(fp);
  }
}
walk(pagesDir);
walk(componentsDir);

let wxsViolation = 0;
for (const fp of allWxml) {
  const src = fs.readFileSync(fp, 'utf8');
  if (/<wxs[\s>]/.test(src)) { fail('wxs 残留: ' + path.relative(ROOT, fp), '不应再使用 <wxs> 标签(WXML 内置表达式已够用)'); wxsViolation++; }
  if (/f\.(price|priceYuan|statusText|formatTime|formatHourMin)\s*\(/.test(src)) { fail('wxs filter 调用: ' + path.relative(ROOT, fp), '不应再调用 f.* 滤镜'); wxsViolation++; }
}
if (wxsViolation === 0) ok('无 <wxs> 标签 / 无 f.* 调用 (兼容老 IDE)');

// utils 下不应有 .wxs 文件
const utilsDir = path.join(ROOT, 'miniprogram/utils');
if (fs.existsSync(utilsDir)) {
  const wxsFiles = fs.readdirSync(utilsDir).filter(f => f.endsWith('.wxs'));
  if (wxsFiles.length === 0) ok('utils 下无 .wxs 文件');
  else wxsFiles.forEach(f => fail('wxs 文件: miniprogram/utils/' + f, '应迁移到 utils/*.js'));
}

// ---------- 输出 ----------
console.log('');
console.log('════════════════════════════════════════════');
console.log(' 通过: ' + passes.length);
console.log(' 失败: ' + failures.length);
console.log('════════════════════════════════════════════');
if (failures.length > 0) {
  console.log('');
  console.log('❌ 失败项:');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.reason));
  process.exit(1);
} else {
  console.log('');
  console.log('✅ 全部通过');
  process.exit(0);
}
