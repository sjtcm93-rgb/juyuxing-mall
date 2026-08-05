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

// 解析多种时间格式
const parseDate = t => {
  if (t == null) return null
  if (t instanceof Date) return isNaN(t.getTime()) ? null : t
  if (typeof t === 'number') {
    const n = t < 1e12 ? t * 1000 : t
    const d = new Date(n)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof t === 'string') {
    let s = t.trim()
    if (!s) return null
    s = s.replace('T', ' ').replace('Z', '').replace(/\//g, '-')
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
    const n = Number(t)
    if (!isNaN(n)) {
      const d2 = new Date(n < 1e12 ? n * 1000 : n)
      return isNaN(d2.getTime()) ? null : d2
    }
    return null
  }
  return null
}

const smartFormatTime = t => {
  const d = parseDate(t)
  if (!d) return ''
  return formatTime(d)
}

const PRICE_FIELDS = ['price', 'totalFee', 'amount', 'discount', 'couponDiscount', 'originalPrice', 'totalCommission', 'monthSales', 'monthCommission', 'available', 'pendingAmount', 'sales', 'totalSales']
const TIME_FIELDS = ['createTime', 'payTime', 'time', 'date', 'updateTime']

function decorateItem(item, opts) {
  if (item == null || typeof item !== 'object') return item
  const r = Object.assign({}, item)
  PRICE_FIELDS.forEach(k => {
    if (typeof r[k] === 'number' && r[k + 'Text'] == null) {
      r[k + 'Text'] = formatPrice(r[k])
    }
  })
  TIME_FIELDS.forEach(k => {
    if (r[k] != null && r[k] !== '' && r[k + 'Text'] == null) {
      r[k + 'Text'] = smartFormatTime(r[k])
    }
  })
  if (opts && opts.status != null && r.statusText == null) {
    r.statusText = getOrderStatusText(opts.status)
  }
  if (typeof r.status === 'string' && r.statusText == null) {
    r.statusText = getOrderStatusText(r.status)
  }
  return r
}

function decorateList(list, opts) {
  if (!Array.isArray(list)) return list
  return list.map(it => decorateItem(it, opts))
}

// 元单位版本: 字段已经是元,只生成 *Text 字符串 (保留 2 位小数)
const YUAN_FIELDS = ['totalCommission', 'available', 'monthSales', 'monthCommission',
  'teamCount', 'monthOrders', 'pendingCount']

function decorateYuanItem(item) {
  if (item == null || typeof item !== 'object') return item
  const r = Object.assign({}, item)
  YUAN_FIELDS.forEach(k => {
    if (typeof r[k] === 'number' && r[k + 'Text'] == null) {
      r[k + 'Text'] = r[k].toFixed(2)
    }
  })
  if (typeof r.pendingCount === 'number' && r.pendingCountText == null) {
    r.pendingCountText = String(r.pendingCount)
  }
  if (typeof r.teamCount === 'number' && r.teamCountText == null) {
    r.teamCountText = String(r.teamCount)
  }
  if (typeof r.monthOrders === 'number' && r.monthOrdersText == null) {
    r.monthOrdersText = String(r.monthOrders)
  }
  return r
}

function decorateYuanList(list) {
  if (!Array.isArray(list)) return list
  return list.map(it => decorateYuanItem(it))
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
  getOrderStatusText,
  parseDate,
  smartFormatTime,
  decorateItem,
  decorateList,
  decorateYuanItem,
  decorateYuanList
}
