const formatTime = date => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}:${s}`
}

const formatDate = date => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const generateOrderNo = () => {
  const now = new Date()
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `JY${ts}${rand}`
}

const toast = (title, icon = 'none') => {
  wx.showToast({ title, icon, duration: 2000 })
}

const showLoading = (title = '加载中...') => {
  wx.showLoading({ title, mask: true })
}

const hideLoading = () => wx.hideLoading()

const formatPrice = price => (price / 100).toFixed(2)

const parsePrice = priceStr => Math.round(parseFloat(priceStr) * 100)

const getOrderStatusText = status => {
  const map = {
    pending: '待支付',
    paid: '已支付',
    shipped: '已发货',
    received: '已收货',
    refunding: '退款中',
    refunded: '已退款',
    cancelled: '已取消'
  }
  return map[status] || '未知状态'
}

module.exports = {
  formatTime,
  formatDate,
  generateOrderNo,
  toast,
  showLoading,
  hideLoading,
  formatPrice,
  parsePrice,
  getOrderStatusText
}
