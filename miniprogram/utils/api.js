// 云函数调用封装（统一走 utils/request.js）
const request = require('./request');

const call = (name, data, options) => request.call(name, data, options);

const API = {
  // 用户
  login: (data, options) => call('login', data, options),
  getReferralStats: (options) => call('login', { action: 'getReferralStats' }, options),
  getReferralCode: (options) => call('login', { action: 'getReferralCode' }, options),

  // 商品
  getProduct: (id, options) => call('product', { action: 'get', id }, options),
  getProductList: (params, options) => call('product', Object.assign({ action: 'list' }, params || {}), options),
  searchProducts: (params, options) => call('product', Object.assign({ action: 'search' }, params || {}), options),

  // 购物车
  getCart: (options) => call('cart', { action: 'get' }, options),
  updateCart: (items, options) => call('cart', { action: 'update', items }, options),
  clearCart: (options) => call('cart', { action: 'clear' }, options),

  // 订单
  createOrder: (data, options) => call('order', Object.assign({ action: 'create' }, data || {}), options),
  getOrderList: (params, options) => call('order', Object.assign({ action: 'list' }, params || {}), options),
  getOrderDetail: (id, options) => call('order', { action: 'detail', id }, options),
  updateOrderStatus: (id, status, options) => call('order', { action: 'updateStatus', id, status }, options),
  cancelOrder: (id, options) => call('order', { action: 'cancel', id }, options),
  requestRefund: (orderId, data, options) => call('order', Object.assign({ action: 'requestRefund', id: orderId }, data || {}), options),
  getRefundDetail: (refundId, options) => call('order', { action: 'refundDetail', id: refundId }, options),
  getMyRefunds: (params, options) => call('order', Object.assign({ action: 'myRefunds' }, params || {}), options),

  // 支付
  requestPayment: (orderId, options) => call('pay', { action: 'request', orderId }, options),

  // 地址
  getAddressList: (options) => call('login', { action: 'getAddresses' }, options),
  addAddress: (data, options) => call('login', Object.assign({ action: 'addAddress' }, data || {}), options),
  updateAddress: (id, data, options) => call('login', Object.assign({ action: 'updateAddress', id }, data || {}), options),
  deleteAddress: (id, options) => call('login', { action: 'deleteAddress', id }, options),

  // 代理
  applyAgent: (data, options) => call('agent', Object.assign({ action: 'apply' }, data || {}), options),
  getAgentInfo: (options) => call('agent', { action: 'info' }, options),
  getAgentPerformance: (options) => call('agent', { action: 'performance' }, options),
  getAgentTeam: (options) => call('agent', { action: 'team' }, options),
  getAgentCommissions: (params, options) => call('agent', Object.assign({ action: 'commissions' }, params || {}), options),

  // 佣金
  getCommissionList: (params, options) => call('commission', Object.assign({ action: 'list' }, params || {}), options),
  withdrawCommission: (amount, options) => call('commission', { action: 'withdraw', amount }, options),

  // 提现
  getWithdrawalInfo: (options) => call('withdrawal', { action: 'info' }, options),
  applyWithdrawal: (data, options) => call('withdrawal', Object.assign({ action: 'apply' }, data || {}), options),
  getWithdrawalList: (params, options) => call('withdrawal', Object.assign({ action: 'list' }, params || {}), options),

  // 退款（管理后台）
  getRefundList: (options) => call('admin', { action: 'refundList' }, options),
  processRefund: (refundId, approve, adminNote, options) => call('admin', { action: 'processRefund', refundId, approve, adminNote }, options),

  // 轮播图
  getBannerList: (options) => call('admin', { action: 'bannerList' }, options),

  // 聊天
  sendChatMessage: (data, options) => call('chat', Object.assign({ action: 'sendMessage' }, data || {}), options),
  getChatMessages: (conversationId, page, options) => call('chat', { action: 'getMessages', conversationId, page }, options),
  getChatConversationList: (options) => call('chat', { action: 'getConversationList' }, options),
  markChatRead: (conversationId, options) => call('chat', { action: 'markAsRead', conversationId }, options),
  getChatUnreadCount: (options) => call('chat', { action: 'getUnreadCount' }, options),

  // 分类
  getCategoryList: (options) => call('category', { action: 'list' }, options),
  getCategoryDetail: (id, options) => call('category', { action: 'detail', id }, options),
  getCategoryProducts: (params, options) => call('category', Object.assign({ action: 'products' }, params || {}), options),

  // 收藏
  toggleFavorite: (productId, options) => call('favorite', { action: 'toggle', productId }, options),
  getFavoriteList: (params, options) => call('favorite', Object.assign({ action: 'list' }, params || {}), options),
  checkFavorite: (productId, options) => call('favorite', { action: 'check', productId }, options),

  // 优惠券
  getCouponCenter: (options) => call('coupon', { action: 'center' }, options),
  claimCoupon: (couponId, options) => call('coupon', { action: 'claim', couponId }, options),
  getMyCoupons: (params, options) => call('coupon', Object.assign({ action: 'mine' }, params || {}), options),
  getAvailableCoupons: (params, options) => call('coupon', Object.assign({ action: 'available' }, params || {}), options),
  calculateCouponDiscount: (data, options) => call('coupon', Object.assign({ action: 'calculate' }, data || {}), options),
  useCoupon: (data, options) => call('coupon', Object.assign({ action: 'use' }, data || {}), options),
};

module.exports = API;
