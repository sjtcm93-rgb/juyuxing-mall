// 统一请求层 —— 集中处理 loading / 错误提示 / 异常分类
// 所有 API.* 方法应改为走 request.call()，保持返回 { success, data, error, code } 结构

const ERROR_MAP = {
  FunctionNotFound: '云函数未部署，请先在云开发控制台上传',
  NETWORK: '网络异常，请检查网络后重试',
  AUTH: '请先登录',
  NO_CLOUD: '云开发未就绪，请先开通云环境',
  EMPTY: '服务返回为空，请稍后重试',
  UNKNOWN: '请求失败，请稍后重试'
};

// 单例 loading 计数器，避免 showLoading / hideLoading 配对错乱
let _loadingCount = 0;

function isCloudReady() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.cloudReady);
  } catch (e) {
    return false;
  }
}

function showLoadingOnce(title) {
  if (_loadingCount === 0) {
    try { wx.showLoading({ title: title || '加载中...', mask: true }); } catch (e) {}
  }
  _loadingCount++;
}

function hideLoadingOnce() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    try { wx.hideLoading(); } catch (e) {}
  }
}

function toast(title, icon) {
  try { wx.showToast({ title: title || '', icon: icon || 'none', duration: 2000 }); } catch (e) {}
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 入参
 * @param {object} options { showLoading, loadingText, silent, timeout }
 */
function call(name, data, options) {
  options = options || {};
  const { showLoading, loadingText, silent } = options;

  if (!isCloudReady()) {
    const err = { success: false, code: 'NO_CLOUD', error: ERROR_MAP.NO_CLOUD };
    if (!silent) toast(err.error);
    return Promise.resolve(err);
  }

  if (showLoading) showLoadingOnce(loadingText);

  return new Promise(function (resolve) {
    wx.cloud.callFunction({ name: name, data: data || {} })
      .then(function (res) {
        const result = res && res.result;
        if (!result || typeof result !== 'object') {
          resolve({ success: false, code: 'EMPTY', error: ERROR_MAP.EMPTY });
          return;
        }
        // 兼容老云函数（无 success 字段但有 data）：视为成功
        if (result.success === undefined && result.data !== undefined) {
          result.success = true;
        }
        // 后端报错的轻提示（仅非 silent 时）
        if (!silent && result.success === false && result.error) {
          toast(result.error);
        }
        resolve(result);
      })
      .catch(function (err) {
        const msg = (err && err.message) || (typeof err === 'string' ? err : '') || '';
        let code = 'UNKNOWN';
        if (msg.indexOf('FunctionNotFound') >= 0 || msg.indexOf('cloud function') >= 0) {
          code = 'FunctionNotFound';
        } else if (msg.indexOf('timeout') >= 0 || msg.indexOf('network') >= 0) {
          code = 'NETWORK';
        }
        const out = { success: false, code: code, error: ERROR_MAP[code] || msg || ERROR_MAP.UNKNOWN };
        if (!silent) toast(out.error);
        resolve(out);
      })
      .finally(function () {
        if (showLoading) hideLoadingOnce();
      });
  });
}

/* —— 工具：防抖 / 节流 —— */
function debounce(fn, wait) {
  var t = null;
 wait = wait || 300;
  return function () {
    var args = arguments;
    var ctx = this;
    if (t) clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, wait);
  };
}

function throttle(fn, wait) {
  var last = 0;
  wait = wait || 1000;
  return function () {
    var now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, arguments);
    }
  };
}

/* —— 网络状态检测 —— */
function checkNetwork() {
  return new Promise(function (resolve) {
    if (!wx.getNetworkType) return resolve(true);
    wx.getNetworkType({
      success: function (res) {
        resolve(res.networkType !== 'none');
      },
      fail: function () { resolve(true); }
    });
  });
}

/* —— 是否已登录 —— */
function isLoggedIn() {
  try {
    return !!wx.getStorageSync('openId');
  } catch (e) { return false; }
}

module.exports = {
  call: call,
  showLoadingOnce: showLoadingOnce,
  hideLoadingOnce: hideLoadingOnce,
  toast: toast,
  debounce: debounce,
  throttle: throttle,
  checkNetwork: checkNetwork,
  isLoggedIn: isLoggedIn,
  ERROR_MAP: ERROR_MAP
};

