/**
 * 橘与杏 中医生活 — Web 管理后台
 * Vue 3 + 微信云开发 JS SDK
 */

const { createApp, ref, reactive, computed, onMounted, nextTick, watch } = Vue;

// ===== 云开发初始化 =====
const ENV_ID = 'cloud1-d4gx1jxk675274501';
const tcbApp = tcb.init({ env: ENV_ID });
const auth = tcbApp.auth({ persistence: 'local' });

// ===== API 封装 =====
async function callAdmin(action, data = {}) {
  const token = localStorage.getItem('adminToken') || '';
  try {
    const res = await tcbApp.callFunction({
      name: 'admin',
      data: { action, adminToken: token, ...data }
    });
    return res.result;
  } catch (e) {
    console.error(`[callAdmin] ${action} failed:`, e);
    return { success: false, error: e.message || '网络请求失败' };
  }
}

async function ensureAnonymousLogin() {
  try {
    const state = await auth.getLoginState();
    if (!state) {
      await auth.signInAnonymously();
    }
  } catch (e) {
    try { await auth.signInAnonymously(); } catch (e2) { console.error('匿名登录失败:', e2); }
  }
}

// ===== Vue App =====
const App = {
  setup() {
    // ----- 全局状态 -----
    const isLoggedIn = ref(!!localStorage.getItem('adminToken'));
    const loading = ref(false);
    const loginPassword = ref('');
    const loginError = ref('');
    const currentPage = ref('dashboard');
    const toast = reactive({ show: false, msg: '', type: 'info', timer: null });

    // ----- 导航 -----
    const pages = [
      { id: 'dashboard', name: '数据看板', icon: '📊' },
      { id: 'orders', name: '订单管理', icon: '📦' },
      { id: 'refunds', name: '退款管理', icon: '🔄' },
      { id: 'products', name: '商品管理', icon: '🏷️' },
      { id: 'agents', name: '代理管理', icon: '👥' },
      { id: 'withdrawals', name: '提现审批', icon: '💰' },
      { id: 'messages', name: '客服消息', icon: '💬' },
      { id: 'settings', name: '系统设置', icon: '⚙️' }
    ];

    // ----- Dashboard -----
    const stats = ref({});
    const recentOrders = ref([]);

    // ----- Orders -----
    const orders = ref([]);
    const orderFilter = ref('');
    const orderFilters = [
      { label: '全部', value: '' },
      { label: '待付款', value: 'pending' },
      { label: '待发货', value: 'paid' },
      { label: '已发货', value: 'shipped' },
      { label: '已收货', value: 'received' },
      { label: '退款中', value: 'refunding' },
      { label: '已退款', value: 'refunded' },
      { label: '已取消', value: 'cancelled' }
    ];
    const shipModal = reactive({ show: false, orderId: '', orderNo: '', company: '', trackingNo: '' });
    const orderDetailModal = reactive({ show: false, data: null });

    // ----- Products -----
    const products = ref([]);
    const productModal = reactive({
      show: false, isEdit: false, data: {}, imagesText: ''
    });

    // ----- Messages -----
    const messageUsers = ref([]);
    const currentChatUser = ref(null);
    const currentChatUserName = ref('');
    const chatMessages = ref([]);
    const replyText = ref('');
    const chatBox = ref(null);

    // ----- Settings -----
    const settings = ref({});
    const pwdForm = reactive({ oldPassword: '', newPassword: '' });
    const newOpenId = ref('');

    // ----- Agents -----
    const agents = ref([]);
    const agentFilter = ref('pending');
    const agentFilters = [
      { label: '待审核', value: 'pending' },
      { label: '已通过', value: 'active' },
      { label: '已拒绝', value: 'rejected' },
      { label: '全部', value: 'all' }
    ];

    // ----- Withdrawals -----
    const withdrawals = ref([]);
    const withdrawalFilter = ref('pending');
    const withdrawalFilters = [
      { label: '待处理', value: 'pending' },
      { label: '已通过', value: 'approved' },
      { label: '已拒绝', value: 'rejected' },
      { label: '全部', value: 'all' }
    ];
    const withdrawalModal = reactive({ show: false, data: null, approve: true, remark: '' });

    // ----- Refunds -----
    const refunds = ref([]);
    const refundFilter = ref('pending');
    const refundFilters = [
      { label: '待处理', value: 'pending' },
      { label: '已同意', value: 'approved' },
      { label: '已拒绝', value: 'rejected' },
      { label: '全部', value: 'all' }
    ];
    const refundModal = reactive({ show: false, data: null, approve: true, adminNote: '' });
    const processingAction = ref(false);

    // ===== 工具函数 =====
    function showToast(msg, type = 'success') {
      if (toast.timer) clearTimeout(toast.timer);
      toast.msg = msg;
      toast.type = type;
      toast.show = true;
      toast.timer = setTimeout(() => { toast.show = false; }, 2500);
    }

    function formatPrice(cents) {
      if (!cents) return '0.00';
      return (cents / 100).toFixed(2);
    }

    function formatTime(time) {
      if (!time) return '-';
      const d = new Date(time);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function statusText(status) {
      const map = {
        pending: '待付款', paid: '待发货', shipped: '已发货', received: '已收货',
        refunding: '退款中', refunded: '已退款', cancelled: '已取消'
      };
      return map[status] || status;
    }

    function orderItemsText(order) {
      if (!order.items || !order.items.length) return '-';
      return order.items.map(i => `${i.name} x${i.quantity}`).join(', ');
    }

    // ===== 登录 =====
    async function doLogin() {
      if (!loginPassword.value) { loginError.value = '请输入密码'; return; }
      loading.value = true;
      loginError.value = '';
      await ensureAnonymousLogin();
      const res = await callAdmin('login', { password: loginPassword.value });
      loading.value = false;
      if (res.success) {
        localStorage.setItem('adminToken', res.token);
        isLoggedIn.value = true;
        loginPassword.value = '';
        showToast('登录成功');
        loadDashboard();
      } else {
        loginError.value = res.error || '登录失败';
      }
    }

    function logout() {
      localStorage.removeItem('adminToken');
      isLoggedIn.value = false;
      currentPage.value = 'dashboard';
    }

    // ===== 页面切换 =====
    function switchPage(pageId) {
      currentPage.value = pageId;
      switch (pageId) {
        case 'dashboard': loadDashboard(); break;
        case 'orders': loadOrders(); break;
        case 'refunds': loadRefunds(); break;
        case 'products': loadProducts(); break;
        case 'agents': loadAgents(); break;
        case 'withdrawals': loadWithdrawals(); break;
        case 'messages': loadMessageUsers(); break;
        case 'settings': loadSettings(); break;
      }
    }

    // ===== Dashboard =====
    async function loadDashboard() {
      const res = await callAdmin('dashboard');
      if (res.success) {
        stats.value = res.stats;
      }
      // 同时加载最近订单
      const orderRes = await callAdmin('orderList', { pageSize: 10 });
      if (orderRes.success) {
        recentOrders.value = orderRes.data;
      }
    }

    // ===== Orders =====
    async function loadOrders() {
      const res = await callAdmin('orderList', { status: orderFilter.value, pageSize: 100 });
      if (res.success) {
        orders.value = res.data;
      }
    }

    function switchOrderFilter(val) {
      orderFilter.value = val;
      loadOrders();
    }

    function openShipModal(order) {
      shipModal.orderId = order._id;
      shipModal.orderNo = order.orderNo;
      shipModal.company = '';
      shipModal.trackingNo = '';
      shipModal.show = true;
    }

    async function confirmShip() {
      const res = await callAdmin('shipOrder', {
        orderId: shipModal.orderId,
        company: shipModal.company,
        trackingNo: shipModal.trackingNo
      });
      if (res.success) {
        showToast('发货成功');
        shipModal.show = false;
        loadOrders();
        loadDashboard();
      } else {
        showToast(res.error || '发货失败', 'error');
      }
    }

    function viewOrder(order) {
      orderDetailModal.data = order;
      orderDetailModal.show = true;
    }

    // ===== Products =====
    async function loadProducts() {
      const res = await callAdmin('productList');
      if (res.success) {
        products.value = res.data;
      }
    }

    function openProductModal(product) {
      if (product) {
        productModal.isEdit = true;
        productModal.data = { ...product };
        productModal.imagesText = (product.images || []).join('\n');
      } else {
        productModal.isEdit = false;
        productModal.data = {
          name: '', subtitle: '', price: '', originalPrice: '',
          stock: '', category: '', description: '', status: 'on'
        };
        productModal.imagesText = '';
      }
      productModal.show = true;
    }

    async function saveProduct() {
      const d = productModal.data;
      const images = productModal.imagesText.split('\n').map(s => s.trim()).filter(Boolean);
      const payload = {
        name: d.name, subtitle: d.subtitle, price: d.price,
        originalPrice: d.originalPrice, stock: d.stock,
        category: d.category, description: d.description,
        images: images, status: d.status || 'on'
      };
      let res;
      if (productModal.isEdit) {
        res = await callAdmin('updateProduct', { id: d._id, ...payload });
      } else {
        res = await callAdmin('createProduct', payload);
      }
      if (res.success) {
        showToast(productModal.isEdit ? '商品已更新' : '商品已创建');
        productModal.show = false;
        loadProducts();
      } else {
        showToast(res.error || '操作失败', 'error');
      }
    }

    async function toggleProduct(product, status) {
      const res = await callAdmin('toggleProductStatus', { id: product._id, status });
      if (res.success) {
        showToast(res.message);
        loadProducts();
      } else {
        showToast(res.error || '操作失败', 'error');
      }
    }

    async function deleteProduct(product) {
      if (!confirm(`确定删除商品「${product.name}」吗？`)) return;
      const res = await callAdmin('deleteProduct', { id: product._id });
      if (res.success) {
        showToast('商品已删除');
        loadProducts();
      } else {
        showToast(res.error || '删除失败', 'error');
      }
    }

    // ===== Messages =====
    async function loadMessageUsers() {
      const res = await callAdmin('messageUsers');
      if (res.success) {
        messageUsers.value = res.data;
      }
    }

    async function selectChatUser(user) {
      currentChatUser.value = user.userOpenId;
      currentChatUserName.value = user.nickName;
      const res = await callAdmin('messageHistory', { userOpenId: user.userOpenId });
      if (res.success) {
        chatMessages.value = res.data;
        nextTick(() => {
          if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight;
        });
      }
    }

    async function sendReply() {
      if (!replyText.value.trim()) return;
      const res = await callAdmin('adminReply', {
        userOpenId: currentChatUser.value,
        content: replyText.value.trim()
      });
      if (res.success) {
        chatMessages.value.push({
          content: replyText.value.trim(),
          isAdmin: true,
          createTime: new Date()
        });
        replyText.value = '';
        nextTick(() => {
          if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight;
        });
        loadMessageUsers();
      } else {
        showToast('发送失败', 'error');
      }
    }

    // ===== Settings =====
    async function loadSettings() {
      const res = await callAdmin('getSettings');
      if (res.success) {
        settings.value = res.settings;
      }
    }

    async function changePassword() {
      const res = await callAdmin('changePassword', {
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword
      });
      if (res.success) {
        showToast('密码已更新');
        pwdForm.oldPassword = '';
        pwdForm.newPassword = '';
        loadSettings();
      } else {
        showToast(res.error || '修改失败', 'error');
      }
    }

    async function addAdminOpenId() {
      if (!newOpenId.value.trim()) return;
      const res = await callAdmin('addAdminOpenId', { openId: newOpenId.value.trim() });
      if (res.success) {
        showToast('已添加管理员');
        newOpenId.value = '';
        loadSettings();
      } else {
        showToast(res.error || '添加失败', 'error');
      }
    }

    async function removeAdminOpenId(openId) {
      if (!confirm('确定移除该管理员？')) return;
      const res = await callAdmin('removeAdminOpenId', { openId });
      if (res.success) {
        showToast('已移除');
        loadSettings();
      } else {
        showToast(res.error || '移除失败', 'error');
      }
    }

    // ===== 佣金比例保存 =====
    async function saveCommissionRate() {
      const rate = settings.value.commissionRate;
      if (rate === undefined || rate === null || isNaN(rate)) {
        showToast('请输入有效的佣金比例', 'error');
        return;
      }
      if (rate < 0 || rate > 1) {
        showToast('佣金比例必须在 0~1 之间', 'error');
        return;
      }
      const res = await callAdmin('setCommissionRate', { commissionRate: rate });
      if (res.success) {
        showToast(res.message || '佣金比例已保存');
      } else {
        showToast(res.error || '保存失败', 'error');
      }
    }

    // ===== Agents =====
    async function loadAgents() {
      const res = await callAdmin('agentList', { statusFilter: agentFilter.value });
      if (res.success) {
        agents.value = res.data;
      }
    }

    function switchAgentFilter(val) {
      agentFilter.value = val;
      loadAgents();
    }

    function agentStatusText(status) {
      const map = { pending: '待审核', active: '已通过', rejected: '已拒绝' };
      return map[status] || status || '-';
    }

    function agentStatusClass(status) {
      const map = { pending: 'status-pending', active: 'status-paid', rejected: 'status-cancelled' };
      return map[status] || 'status-cancelled';
    }

    async function approveAgent(agent, approve) {
      const name = (agent.agentInfo && agent.agentInfo.name) || agent.nickName || '该代理';
      if (!confirm(`确定${approve ? '通过' : '拒绝'}「${name}」的代理申请？`)) return;
      const res = await callAdmin('approveAgent', { userId: agent._id, approve });
      if (res.success) {
        showToast(approve ? '已通过代理申请' : '已拒绝代理申请');
        loadAgents();
        loadDashboard();
      } else {
        showToast(res.error || '操作失败', 'error');
      }
    }

    // ===== Withdrawals =====
    async function loadWithdrawals() {
      const res = await callAdmin('withdrawalList', { statusFilter: withdrawalFilter.value });
      if (res.success) {
        withdrawals.value = res.data;
      }
    }

    function switchWithdrawalFilter(val) {
      withdrawalFilter.value = val;
      loadWithdrawals();
    }

    function withdrawalStatusText(status) {
      const map = { pending: '待处理', approved: '已通过', rejected: '已拒绝' };
      return map[status] || status || '-';
    }

    function withdrawalStatusClass(status) {
      const map = { pending: 'status-pending', approved: 'status-paid', rejected: 'status-cancelled' };
      return map[status] || 'status-cancelled';
    }

    function withdrawalMethodText(wd) {
      if (wd.bankInfo && wd.bankInfo.cardNo) {
        return `银行 ${wd.bankInfo.bank} ${wd.bankInfo.cardNo.slice(-4)}`;
      }
      if (wd.alipayInfo && wd.alipayInfo.account) {
        return `支付宝 ${wd.alipayInfo.account.slice(-4)}`;
      }
      return wd.method || '未填写';
    }

    function openWithdrawalModal(wd, approve) {
      withdrawalModal.data = wd;
      withdrawalModal.approve = approve;
      withdrawalModal.remark = '';
      withdrawalModal.show = true;
    }

    function viewWithdrawal(wd) {
      withdrawalModal.data = wd;
      withdrawalModal.approve = wd.status === 'pending';
      withdrawalModal.remark = wd.remark || '';
      withdrawalModal.show = true;
    }

    async function confirmWithdrawal() {
      processingAction.value = true;
      const res = await callAdmin('processWithdrawal', {
        withdrawalId: withdrawalModal.data._id,
        approve: withdrawalModal.approve,
        remark: withdrawalModal.remark
      });
      processingAction.value = false;
      if (res.success) {
        showToast(res.message || '处理成功');
        withdrawalModal.show = false;
        loadWithdrawals();
        loadDashboard();
      } else {
        showToast(res.error || '操作失败', 'error');
      }
    }

    // ===== Refunds =====
    async function loadRefunds() {
      const res = await callAdmin('refundList', { statusFilter: refundFilter.value });
      if (res.success) {
        refunds.value = res.data;
      }
    }

    function switchRefundFilter(val) {
      refundFilter.value = val;
      loadRefunds();
    }

    function refundStatusText(status) {
      const map = { pending: '待处理', approved: '已同意', rejected: '已拒绝' };
      return map[status] || status || '-';
    }

    function refundStatusClass(status) {
      const map = { pending: 'status-refunding', approved: 'status-refunded', rejected: 'status-cancelled' };
      return map[status] || 'status-cancelled';
    }

    function openRefundModal(rf, approve) {
      refundModal.data = rf;
      refundModal.approve = approve;
      refundModal.adminNote = '';
      refundModal.show = true;
    }

    function viewRefund(rf) {
      refundModal.data = rf;
      refundModal.approve = rf.status === 'pending';
      refundModal.adminNote = rf.adminNote || '';
      refundModal.show = true;
    }

    async function confirmRefund() {
      processingAction.value = true;
      const res = await callAdmin('processRefund', {
        refundId: refundModal.data._id,
        approve: refundModal.approve,
        adminNote: refundModal.adminNote
      });
      processingAction.value = false;
      if (res.success) {
        showToast(res.message || '处理成功');
        refundModal.show = false;
        loadRefunds();
        loadDashboard();
      } else {
        showToast(res.error || '操作失败', 'error');
      }
    }

    // ===== 初始化 =====
    onMounted(() => {
      if (isLoggedIn.value) {
        ensureAnonymousLogin().then(() => loadDashboard());
      }
    });

    return {
      // 全局
      isLoggedIn, loading, loginPassword, loginError, currentPage, pages, toast,
      // dashboard
      stats, recentOrders,
      // orders
      orders, orderFilter, orderFilters, shipModal, orderDetailModal,
      // products
      products, productModal,
      // agents
      agents, agentFilter, agentFilters,
      // withdrawals
      withdrawals, withdrawalFilter, withdrawalFilters, withdrawalModal,
      // refunds
      refunds, refundFilter, refundFilters, refundModal, processingAction,
      // messages
      messageUsers, currentChatUser, currentChatUserName, chatMessages, replyText, chatBox,
      // settings
      settings, pwdForm, newOpenId,
      // methods
      doLogin, logout, switchPage,
      loadDashboard, loadOrders, switchOrderFilter, openShipModal, confirmShip, viewOrder,
      loadProducts, openProductModal, saveProduct, toggleProduct, deleteProduct,
      loadAgents, switchAgentFilter, approveAgent, agentStatusText, agentStatusClass,
      loadWithdrawals, switchWithdrawalFilter, withdrawalStatusText, withdrawalStatusClass, withdrawalMethodText, openWithdrawalModal, viewWithdrawal, confirmWithdrawal,
      loadRefunds, switchRefundFilter, refundStatusText, refundStatusClass, openRefundModal, viewRefund, confirmRefund,
      loadMessageUsers, selectChatUser, sendReply,
      loadSettings, changePassword, addAdminOpenId, removeAdminOpenId, saveCommissionRate,
      // utils
      formatPrice, formatTime, statusText, orderItemsText
    };
  }
};

createApp(App).mount('#app');
