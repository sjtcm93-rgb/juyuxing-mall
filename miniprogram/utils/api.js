// 云函数调用封装
const callFunction = require('./cloud').callFunction;

const API = {
  // 用户相关
  login: (data) => callFunction('login', data),
  
  // 商品相关
  getProduct: (id) => callFunction('product', { action: 'get', id }),
  getProductList: (params) => callFunction('product', { action: 'list', ...params }),
  
  // 购物车相关
  getCart: () => callFunction('cart', { action: 'get' }),
  updateCart: (items) => callFunction('cart', { action: 'update', items }),
  clearCart: () => callFunction('cart', { action: 'clear' }),
  
  // 订单相关
  createOrder: (data) => callFunction('order', { action: 'create', ...data }),
  getOrderList: (params) => callFunction('order', { action: 'list', ...params }),
  getOrderDetail: (id) => callFunction('order', { action: 'detail', id }),
  updateOrderStatus: (id, status) => callFunction('order', { action: 'updateStatus', id, status }),
  cancelOrder: (id) => callFunction('order', { action: 'cancel', id }),
  
  // 支付相关
  requestPayment: (orderId) => callFunction('pay', { action: 'request', orderId }),
  
  // 地址相关
  getAddressList: () => callFunction('login', { action: 'getAddresses' }),
  addAddress: (data) => callFunction('login', { action: 'addAddress', ...data }),
  updateAddress: (id, data) => callFunction('login', { action: 'updateAddress', id, ...data }),
  deleteAddress: (id) => callFunction('login', { action: 'deleteAddress', id }),
  
  // 代理相关
  applyAgent: (data) => callFunction('agent', { action: 'apply', ...data }),
  getAgentInfo: () => callFunction('agent', { action: 'info' }),
  getAgentPerformance: () => callFunction('agent', { action: 'performance' }),
  getAgentTeam: () => callFunction('agent', { action: 'team' }),
  getAgentCommissions: (params) => callFunction('agent', { action: 'commissions', ...params }),
  
  // 佣金相关
  getCommissionList: (params) => callFunction('commission', { action: 'list', ...params }),
  withdrawCommission: (amount) => callFunction('commission', { action: 'withdraw', amount }),
};

module.exports = API;

// 提现相关
API.getWithdrawalInfo = () => callFunction('withdrawal', { action: 'info' });
API.applyWithdrawal = (data) => callFunction('withdrawal', { action: 'apply', ...data });
API.getWithdrawalList = (params) => callFunction('withdrawal', { action: 'list', ...params });
