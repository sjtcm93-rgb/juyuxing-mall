const { toast } = require('../../utils/util');

Page({
  data: {
    messages: [],
    inputText: '',
    hasInput: false,
    toId: '',
    isAdmin: false,
    chatTitle: '客服',
    userInfo: {},
    scrollToMsg: '',
    page: 1,
    hasMore: true,
    loading: false,
    loadError: '',
    pollTimer: null,
    sending: false
  },

  onLoad(options) {
    const { toId, isAdmin, userInfo } = options;
    const isAdminMode = isAdmin === 'true' || isAdmin === true;
    let title = '客服';
    let parsedUserInfo = {};
    try {
      if (userInfo) parsedUserInfo = JSON.parse(decodeURIComponent(userInfo));
    } catch (e) {}
    if (isAdminMode && parsedUserInfo.nickName) title = parsedUserInfo.nickName || '用户';

    this.setData({
      toId: toId || '',
      isAdmin: isAdminMode,
      chatTitle: title,
      userInfo: parsedUserInfo
    });
    wx.setNavigationBarTitle({ title });
    this.loadMessages();
    this.startPolling();
  },

  onUnload() { this.stopPolling(); },
  onHide() { this.stopPolling(); },
  onShow() {
    if (!this.data.pollTimer) this.startPolling();
    this.loadMessages();
  },

  startPolling() {
    this.stopPolling();
    const timer = setInterval(() => this.loadMessages(false), 5000);
    this.setData({ pollTimer: timer });
  },

  stopPolling() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null });
    }
  },

  async loadMessages(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true, loadError: '' });
    try {
      const page = reset ? 1 : this.data.page;
      const openId = wx.getStorageSync('openId');
      const conversationId = this.data.isAdmin ? this.data.toId : openId;
      const res = await wx.cloud.callFunction({
        name: 'chat',
        data: { action: 'getMessages', conversationId, page, pageSize: 50 }
      });
      if (res.result && res.result.success) {
        const msgs = res.result.data || [];
        const processed = msgs.map((msg, idx) => {
          const msgId = msg._id || ('msg_' + idx);
          const safeId = 'msg_' + String(msgId).replace(/[^a-zA-Z0-9]/g, '_');
          return Object.assign({}, msg, {
            _isMe: msg.fromId === openId,
            _timeStr: this.formatMsgTime(msg.createTime),
            _id: safeId
          });
        });
        this.setData({ messages: processed, hasMore: msgs.length === 50, loading: false });
        await wx.cloud.callFunction({ name: 'chat', data: { action: 'markAsRead', conversationId } }).catch(() => {});
        if (reset && processed.length > 0) {
          const lastId = processed[processed.length - 1]._id;
          setTimeout(() => this.setData({ scrollToMsg: lastId }), 100);
        }
      } else {
        this.setData({ loading: false, loadError: (res.result && res.result.error) || '加载失败' });
      }
    } catch (err) {
      this.setData({ loading: false, loadError: '网络异常' });
    }
  },

  formatMsgTime(date) {
    if (!date) return '';
    const d = new Date(typeof date === 'number' ? date : String(date).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return '';
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onInputChange(e) {
    this.setData({ inputText: e.detail.value, hasInput: !!(e.detail.value && e.detail.value.trim()) });
  },

  async sendMessage() {
    if (this.data.sending) return;
    const text = this.data.inputText.trim();
    if (!text) return;
    if (!wx.getStorageSync('openId')) { toast('请先登录'); return; }
    this.setData({ sending: true });

    const openId = wx.getStorageSync('openId');
    const tempMsg = {
      _id: 'temp_' + Date.now(),
      type: 'text',
      content: text,
      fromId: openId,
      toId: this.data.toId || '',
      conversationId: this.data.isAdmin ? this.data.toId : openId,
      createTime: new Date(),
      isRead: false,
      isAdmin: this.data.isAdmin,
      _isMe: true,
      _timeStr: this.formatMsgTime(new Date()),
      _isTemp: true
    };
    this.setData({
      inputText: '',
      hasInput: false,
      messages: this.data.messages.concat([tempMsg]),
      scrollToMsg: tempMsg._id
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'chat',
        data: { action: 'sendMessage', type: 'text', content: text, toId: this.data.toId || undefined }
      });
      if (res.result && res.result.success) {
        setTimeout(() => this.loadMessages(), 600);
      } else {
        const errMsg = (res.result && res.result.error) || '发送失败';
        this.setData({
          messages: this.data.messages.filter(m => m._id !== tempMsg._id),
          inputText: text, hasInput: true
        });
        toast(errMsg.indexOf('DB_ERROR') >= 0 ? '请先创建 messages 集合' : '发送失败：' + errMsg);
      }
    } catch (err) {
      this.setData({
        messages: this.data.messages.filter(m => m._id !== tempMsg._id),
        inputText: text, hasInput: true
      });
      toast('发送失败，请重试');
    } finally {
      this.setData({ sending: false });
    }
  },

  retry() { this.loadMessages(); }
});
