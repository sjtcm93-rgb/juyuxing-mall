const cloud = require('wx-server-sdk');
const ENV_ID = 'cloud1-d4gx1jxk675274501';
cloud.init({ env: ENV_ID });
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

      // ===== 自动设管理员：如果 admin_config 里 openId 为空，自动把当前用户设为管理员 =====
      try {
        const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
        if (!adminRes || !adminRes.data) {
          console.warn('[login] admin_config 文档不存在，请管理员手动在云数据库中创建并配置 adminOpenIds');
        } else {
          const cfg = adminRes.data;
          const adminOpenIds = cfg.adminOpenIds || [];
          const legacyOpenId = cfg.openId || '';
          if (!legacyOpenId && adminOpenIds.length === 0) {
            console.warn('[login] admin_config 存在但未配置任何管理员 openId，请管理员在云开发控制台手动添加');
          }
        }
      } catch (adminErr) {
        console.error('[login] 检查 admin_config 失败（不影响登录）:', adminErr);
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
      // 校验地址所有权
      const addrCheck = await db.collection('addresses').where({ _id: addrId, userId: OPENID }).count();
      if (addrCheck.total === 0) {
        return { success: false, error: '地址不存在或无权限' };
      }
      await db.collection('addresses').doc(addrId).update({ data: update });
      return { success: true };
    }

    case 'deleteAddress': {
      // 校验地址所有权
      const addrCheck = await db.collection('addresses').where({ _id: event.id, userId: OPENID }).count();
      if (addrCheck.total === 0) {
        return { success: false, error: '地址不存在或无权限' };
      }
      await db.collection('addresses').doc(event.id).remove();
      return { success: true };
    }

    case 'getReferralStats': {
      // 老带新统计：成功邀请人数 + 获得奖励券数量
      const events = await db.collection('referral_events')
        .where({ referrerId: OPENID, type: 'first_purchase_reward' })
        .limit(500)
        .get();
      const list = events.data || [];
      const distinctReferees = [...new Set(list.map(e => e.refereeId))];
      return {
        success: true,
        successCount: distinctReferees.length,
        rewardCount: list.length
      };
    }

    case 'getReferralCode': {
      // 获取/生成当前用户的推广码
      const userRes = await db.collection('users').doc(OPENID).get();
      if (!userRes.data) return { success: false, error: '用户不存在' };
      let code = userRes.data.referralCode || '';
      if (!code) {
        // 生成推广码：JYX + 6位随机字母数字
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let attempts = 0;
        while (!code && attempts < 10) {
          const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
          code = 'JYX' + rand;
          // 检查是否已存在
          const exist = await db.collection('users').where({ referralCode: code }).count();
          if (exist.total === 0) {
            await db.collection('users').doc(OPENID).update({ data: { referralCode: code } });
          } else {
            code = ''; // 冲突，重新生成
          }
          attempts++;
        }
      }
      return { success: true, code };
    }

    default:
      return { success: false, error: 'unknown action: ' + action };
  }
};
