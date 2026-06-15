let called = false;

function init() {
  if (called) return;
  called = true;
  wx.cloud.init({
    env: getApp().globalData.envId,
    traceUser: true
  });
}

function callFunction(name, data) {
  return wx.cloud.callFunction({
    name,
    data
  }).then(res => res.result);
}

function getDatabase() {
  return wx.cloud.database();
}

module.exports = {
  init,
  callFunction,
  getDatabase
};
