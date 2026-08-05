function callFunction(name, data) {
  const app = getApp();
  if (!app.globalData.cloudReady) {
    console.warn('[云函数] 云开发未就绪，跳过调用:', name);
    return Promise.resolve({ success: false, error: '云开发未开通，请在开发者工具中开通云开发环境' });
  }
  return wx.cloud.callFunction({
    name,
    data
  }).then(res => res.result).catch(err => {
    console.error('[云函数] 调用失败:', name, err.message);
    return { success: false, error: err.message || '云函数调用失败' };
  });
}

function getDatabase() {
  const app = getApp();
  if (!app.globalData.cloudReady) {
    console.warn('[云数据库] 云开发未就绪');
    return null;
  }
  return wx.cloud.database();
}

module.exports = {
  callFunction,
  getDatabase
};
