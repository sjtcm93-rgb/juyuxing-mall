const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  
  // 如果没有指定 action，默认为 login（兼容简洁调用方式）
  const action = event.action || 'login';

  switch (action) {
    case 'login': {
      const ref = event.ref || '';
      // 查找或创建用户
      const userRes = await db.collection('users').where({ _id: OPENID }).get();
      if (userRes.data.length === 0) {
        const userData = {
          _id: OPENID,
          nickName: event.nickName || '',
          avatarUrl: event.avatarUrl || '',
          phone: '',
          isAgent: false,
          agentInfo: { level: '', code: '', applyTime: null, status: '' },
          referrer: ref || '',
          createTime: db.serverDate()
        };
        await db.collection('users').add({ data: userData });
      } else {
        // 已存在的用户，更新可能的新信息
        const updateData = {};
        if (event.nickName) updateData.nickName = event.nickName;
        if (event.avatarUrl) updateData.avatarUrl = event.avatarUrl;
        if (ref && !userRes.data[0].referrer) {
          // 只在用户还没有推荐人时写入（永久绑定）
          updateData.referrer = ref;
        }
        if (Object.keys(updateData).length > 0) {
          await db.collection('users').doc(OPENID).update({ data: updateData });
        }
      }
      return { success: true, openId: OPENID };
    }

    case 'updateUserInfo': {
      const updateData = {};
      if (event.nickName) updateData.nickName = event.nickName;
      if (event.avatarUrl) updateData.avatarUrl = event.avatarUrl;
      if (event.phone) updateData.phone = event.phone;
      if (Object.keys(updateData).length > 0) {
        await db.collection('users').doc(OPENID).update({ data: updateData });
      }
      return { success: true };
    }

    case 'getAddresses': {
      const res = await db.collection('addresses')
        .where({ userId: OPENID })
        .orderBy('isDefault', 'desc')
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data };
    }

    case 'addAddress': {
      const addrData = {
        userId: OPENID,
        name: event.name,
        phone: event.phone,
        region: event.region,
        detail: event.detail,
        isDefault: !!event.isDefault,
        createTime: db.serverDate()
      };
      if (addrData.isDefault) {
        await db.collection('addresses')
          .where({ userId: OPENID })
          .update({ data: { isDefault: false } });
      }
      const res = await db.collection('addresses').add({ data: addrData });
      return { success: true, data: res._id };
    }

    case 'updateAddress': {
      const addrId = event.id;
      const update = {};
      if (event.name !== undefined) update.name = event.name;
      if (event.phone !== undefined) update.phone = event.phone;
      if (event.region !== undefined) update.region = event.region;
      if (event.detail !== undefined) update.detail = event.detail;
      if (event.isDefault !== undefined) {
        update.isDefault = !!event.isDefault;
        if (update.isDefault) {
          await db.collection('addresses')
            .where({ userId: OPENID })
            .update({ data: { isDefault: false } });
        }
      }
      await db.collection('addresses').doc(addrId).update({ data: update });
      return { success: true };
    }

    case 'deleteAddress': {
      await db.collection('addresses').doc(event.id).remove();
      return { success: true };
    }

    default:
      return { success: false, error: 'unknown action: ' + action };
  }
};
