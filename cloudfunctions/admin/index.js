const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const ENV_ID = 'cloud1-d4gx1jxk675274501';
cloud.init({ env: ENV_ID });
const db = cloud.database();
const _ = db.command;

// 密码哈希：SHA-256
function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
}

// 校验密码：同时兼容明文旧密码与已哈希的密码
function verifyPassword(inputPwd, storedPwd) {
  if (!storedPwd) return false;
  if (inputPwd === storedPwd) return true;
  try {
    return hashPassword(inputPwd) === storedPwd;
  } catch (e) {
    return false;
  }
}

exports.main = async (event, context) => {
  try {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'dashboard';
  const adminToken = event.adminToken || '';

  // ===== 登录接口：不需要管理员权限验证 =====
  if (action === 'login') {
    const { password } = event;
    const loginRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
    const configData = (loginRes && loginRes.data) || {};
    if (!configData.password) {
      return { success: false, error: '管理员密码未设置，请在云开发数据库 admin_config 集合中添加 password 字段' };
    }
    if (!verifyPassword(password, configData.password)) {
      return { success: false, error: '密码错误' };
    }
    // 如果存的是明文，升级为哈希
    const passwordHash = hashPassword(password);
    if (configData.password !== passwordHash && password === configData.password) {
      await db.collection('admin_config').doc('admin').update({
        data: { password: passwordHash }
      });
    }
    // 生成安全 token，24小时过期
    const token = crypto.randomBytes(32).toString('hex');
    const expireTime = new Date();
    expireTime.setHours(expireTime.getHours() + 24);
    await db.collection('admin_config').doc('admin').update({
      data: { webToken: token, webTokenExpire: expireTime }
    });
    return { success: true, token };
  }

  // ===== 验证管理员身份：支持小程序 OPENID 和 Web token 两种方式 =====
  const adminRes = await db.collection('admin_config').doc('admin').get().catch(() => null);
  const configData = (adminRes && adminRes.data) || {};
  const adminOpenIds = configData.adminOpenIds || [];
  const legacyOpenId = configData.openId || '';
  let isAdmin = !!(OPENID && (OPENID === legacyOpenId || adminOpenIds.includes(OPENID)));

  // Web 端 token 验证
  if (!isAdmin && adminToken && configData.webToken === adminToken) {
    const expire = configData.webTokenExpire;
    if (expire && new Date(expire) > new Date()) {
      isAdmin = true;
    }
  }

  if (!isAdmin) {
    return { success: false, error: '无管理员权限' };
  }

  // ===== 轻量级权限检查：不做任何数据库查询，只返回是否是管理员 =====
  if (action === 'checkAdmin') {
    return { success: true };
  }

  switch (action) {

    case 'dashboard': {
      // 订单统计（每个查询独立 try-catch，防止集合不存在导致整体崩溃）
      let totalOrders = { total: 0 };
      let paidOrders = { total: 0 };
      let shippedOrders = { total: 0 };
      let allOrders = { data: [] };
      let pendingAgents = { total: 0 };
      let pendingWithdrawals = { total: 0 };
      let pendingRefunds = { total: 0 };

      try { totalOrders = await db.collection('orders').count(); } catch(e) {}
      try { paidOrders = await db.collection('orders').where({ status: 'paid' }).count(); } catch(e) {}
      try { shippedOrders = await db.collection('orders').where({ status: 'shipped' }).count(); } catch(e) {}
      try { allOrders = await db.collection('orders').where({ status: _.in(['paid', 'shipped', 'received']) }).get(); } catch(e) {}
      try { pendingAgents = await db.collection('users').where({ 'agentInfo.status': 'pending' }).count(); } catch(e) {}
      try { pendingWithdrawals = await db.collection('withdrawals').where({ status: 'pending' }).count(); } catch(e) {}
      try { pendingRefunds = await db.collection('refunds').where({ status: 'pending' }).count(); } catch(e) {}

      const totalSales = allOrders.data.reduce((s, o) => s + (o.totalFee || 0), 0);

      return {
        success: true,
        stats: {
          totalOrders: totalOrders.total,
          paidOrders: paidOrders.total,
          shippedOrders: shippedOrders.total,
          totalSales,
          pendingAgents: pendingAgents.total,
          pendingWithdrawals: pendingWithdrawals.total,
          pendingRefunds: pendingRefunds.total
        }
      };
    }

    case 'orderList': {
      const pageSize = event.pageSize || 50;
      const page = event.page || 1;
      const status = event.status || '';
      let query = {};
      if (status) query.status = status;
      const res = await db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();
      return { success: true, data: res.data };
    }

    case 'shipOrder': {
      // 发货：更新订单状态 + 添加物流信息
      const { orderId, company, trackingNo } = event;
      if (!orderId || !company || !trackingNo) {
        return { success: false, error: '请填写完整的物流信息' };
      }
      await db.collection('orders').doc(orderId).update({
        data: {
          status: 'shipped',
          logistics: { company, trackingNo, status: '已发货' },
          shipTime: db.serverDate()
        }
      });
      return { success: true, message: '已标记为发货' };
    }

    case 'agentList': {
      // 获取代理列表，支持状态筛选
      const statusFilter = event.statusFilter || 'pending';
      let query = {};
      if (statusFilter !== 'all') {
        query['agentInfo.status'] = statusFilter;
      }
      const res = await db.collection('users')
        .where(query)
        .orderBy('createTime', 'desc')
        .limit(100)
        .get();
      return { success: true, data: res.data };
    }

    case 'approveAgent': {
      const { userId, approve } = event;
      if (approve) {
        await db.collection('users').doc(userId).update({
          data: {
            isAgent: true,
            'agentInfo.level': '初级代理',
            'agentInfo.status': 'active'
          }
        });
      } else {
        await db.collection('users').doc(userId).update({
          data: {
            isAgent: false,
            'agentInfo.status': 'rejected'
          }
        });
      }
      return { success: true };
    }

    case 'withdrawalList': {
      // 获取提现列表，支持状态筛选
      const statusFilter = event.statusFilter || 'pending';
      let query = {};
      if (statusFilter !== 'all') {
        query.status = statusFilter;
      }
      const res = await db.collection('withdrawals')
        .where(query)
        .orderBy('createTime', 'desc')
        .limit(100)
        .get();
      return { success: true, data: res.data };
    }

    case 'processWithdrawal': {
      // 关键修复：通过审批时必须把对应的 settled 佣金标记为 paid，
      // 否则代理可以重复提现同一笔已结算佣金。
      const { withdrawalId, approve, remark } = event;
      const wdRes = await db.collection('withdrawals').doc(withdrawalId).get();
      const wd = wdRes.data;
      if (!wd) return { success: false, error: '提现记录不存在' };
      if (wd.status !== 'pending') return { success: false, error: '该提现申请已处理' };

      if (approve) {
        await db.collection('withdrawals').doc(withdrawalId).update({
          data: { status: 'approved', processTime: db.serverDate(), remark: remark || '' }
        });

        // 按 settleTime 正序消费 settled 佣金，超出部分做拆分。
        let remaining = wd.amount;
        const settledList = await db.collection('commissions')
          .where({ agentId: wd.agentId, status: 'settled' })
          .orderBy('settleTime', 'asc')
          .get();

        for (const c of settledList.data) {
          if (remaining <= 0) break;
          const consume = Math.min(c.amount, remaining);
          if (consume === c.amount) {
            await db.collection('commissions').doc(c._id).update({
              data: {
                status: 'paid',
                paidTime: db.serverDate(),
                paidByWithdrawal: withdrawalId
              }
            });
          } else {
            // 部分消耗：扣减当前条目，再新建一条 paid 记录作为本次发放
            await db.collection('commissions').doc(c._id).update({
              data: { amount: c.amount - consume }
            });
            await db.collection('commissions').add({
              data: {
                agentId: wd.agentId,
                orderId: c.orderId,
                orderNo: c.orderNo,
                amount: consume,
                rate: c.rate,
                status: 'paid',
                settleTime: c.settleTime,
                paidTime: db.serverDate(),
                paidByWithdrawal: withdrawalId,
                source: 'split-from-' + c._id
              }
            });
          }
          remaining -= consume;
        }
        // remaining > 0 表示 settled 不足（理论上 withdrawal.apply 已校验过）
        return { success: true, message: '已确认打款', consumed: wd.amount - remaining };
      } else {
        await db.collection('withdrawals').doc(withdrawalId).update({
          data: { status: 'rejected', processTime: db.serverDate(), remark: remark || '' }
        });
        // 拒绝时不消耗佣金，用户可重新申请
        return { success: true, message: '已拒绝' };
      }
    }

    case 'refundList': {
      // 获取退款列表，支持状态筛选
      const statusFilter = event.statusFilter || 'pending';
      let query = {};
      if (statusFilter !== 'all') {
        query.status = statusFilter;
      }
      const res = await db.collection('refunds')
        .where(query)
        .orderBy('createTime', 'desc')
        .limit(100)
        .get();
      // 补充订单信息
      const refunds = res.data;
      for (const rf of refunds) {
        const ordRes = await db.collection('orders').doc(rf.orderId).get().catch(() => null);
        rf.order = ordRes && ordRes.data ? ordRes.data : null;
      }
      return { success: true, data: refunds };
    }

    case 'processRefund': {
      // 处理退款申请（通过/拒绝）
      const { refundId, approve, adminNote } = event;
      const rfRes = await db.collection('refunds').doc(refundId).get();
      const rf = rfRes.data;
      if (!rf) return { success: false, error: '退款记录不存在' };
      if (rf.status !== 'pending') return { success: false, error: '该退款申请已处理' };

      if (!approve) {
        // ===== 拒绝退款：恢复订单原状态 =====
        await db.collection('refunds').doc(refundId).update({
          data: { status: 'rejected', adminNote: adminNote || '', processTime: db.serverDate() }
        });
        const prevStatus = rf.prevStatus || 'paid';
        await db.collection('orders').doc(rf.orderId).update({
          data: { status: prevStatus, refundId: '' }
        });
        return { success: true, message: '已拒绝退款' };
      }

      // ===== 同意退款 =====
      // 获取订单信息
      const orderRes = await db.collection('orders').doc(rf.orderId).get().catch(() => null);
      const order = orderRes && orderRes.data;
      if (!order) return { success: false, error: '关联订单不存在' };

      // 检查是否有微信支付交易号（没有就无法调用退款API）
      if (!order.transactionId) {
        // 没有交易号，可能是测试订单或支付回调未正确记录
        // 先标记退款记录为 approved，再标记订单为 refunded（线下手动退款）
        await db.collection('refunds').doc(refundId).update({
          data: { status: 'approved', adminNote: (adminNote || '') + ' [无交易号，需线下退款]', processTime: db.serverDate() }
        });
        await db.collection('orders').doc(rf.orderId).update({
          data: { status: 'refunded' }
        });
        return { success: true, message: '已同意退款（无交易号，需线下手动退款）' };
      }

      // 商户号
      const DEFAULT_MCHID = '1114186048';
      let subMchId = DEFAULT_MCHID;
      try {
        const payConfig = await db.collection('pay_config').doc('default').get();
        subMchId = (payConfig.data && payConfig.data.subMchId) || DEFAULT_MCHID;
      } catch (e) {}

      // 先调用微信退款 API，成功后再更新状态
      try {
        const refundRes = await cloud.cloudPay.refund({
          subMchId: subMchId,
          outTradeNo: order.orderNo,
          outRefundNo: 'REFUND_' + order.orderNo + '_' + Date.now(),
          totalFee: order.totalFee,
          refundFee: order.totalFee,
          envId: ENV_ID,
          functionName: 'payNotify'
        });

        if (refundRes.returnCode === 'SUCCESS' && refundRes.refundId) {
          // 退款成功：更新退款记录 + 订单状态
          await db.collection('refunds').doc(refundId).update({
            data: {
              status: 'approved',
              adminNote: adminNote || '',
              refundId: refundRes.refundId,
              refundTime: db.serverDate(),
              processTime: db.serverDate()
            }
          });
          await db.collection('orders').doc(rf.orderId).update({
            data: { status: 'refunded' }
          });

          // 回收已结算佣金：将 settled 佣金标记为 refunded，防止代理提现
          if (order.agentId) {
            try {
              const commRes = await db.collection('commissions')
                .where({ orderId: order._id, status: 'settled' })
                .get();
              for (const comm of commRes.data) {
                await db.collection('commissions').doc(comm._id).update({
                  data: {
                    status: 'refunded',
                    refundTime: db.serverDate(),
                    refundNote: '订单退款，佣金回收'
                  }
                });
              }
              // 同步更新订单佣金状态
              if (commRes.data.length > 0) {
                await db.collection('orders').doc(rf.orderId).update({
                  data: { commissionStatus: 'refunded' }
                });
              }
              console.log('[processRefund] 已回收佣金记录:', commRes.data.length);
            } catch (commErr) {
              console.error('[processRefund] 佣金回收失败:', commErr);
            }
          }

          return { success: true, message: '退款已发起，资金将原路退回' };
        } else {
          // 退款接口返回失败
          console.error('退款失败:', refundRes);
          return { success: false, error: '退款失败: ' + (refundRes.returnMsg || refundRes.errCodeDes || '未知错误') };
        }
      } catch (refundErr) {
        console.error('退款异常:', refundErr);
        return { success: false, error: '退款接口异常: ' + (refundErr.errMsg || refundErr.message || '请稍后重试') };
      }
    }

    case 'productList': {
      const res = await db.collection('products')
        .orderBy('createTime', 'desc')
        .get();
      return { success: true, data: res.data };
    }

    case 'createProduct': {
      const { name, subtitle, price, originalPrice, stock, specs, images, description, category, status } = event;
      if (!name || !price) {
        return { success: false, error: '商品名称和价格不能为空' };
      }
      const res = await db.collection('products').add({
        data: {
          name: name.trim(),
          subtitle: subtitle || '',
          price: Number(price),
          originalPrice: Number(originalPrice) || 0,
          stock: Number(stock) || 0,
          specs: specs || [{ name: '默认规格', stock: Number(stock) || 0 }],
          images: images || [],
          description: description || '',
          category: category || '',
          status: status || 'on',
          sales: 0,
          rating: 5.0,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      return { success: true, productId: res._id, message: '商品创建成功' };
    }

    case 'updateProduct': {
      const { id, name, subtitle, price, originalPrice, stock, specs, images, description, category, status } = event;
      if (!id) return { success: false, error: '商品ID不能为空' };
      const updateData = {};
      if (name !== undefined) updateData.name = name.trim();
      if (subtitle !== undefined) updateData.subtitle = subtitle;
      if (price !== undefined) updateData.price = Number(price);
      if (originalPrice !== undefined) updateData.originalPrice = Number(originalPrice) || 0;
      if (stock !== undefined) updateData.stock = Number(stock) || 0;
      if (specs !== undefined) updateData.specs = specs;
      if (images !== undefined) updateData.images = images;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (status !== undefined) updateData.status = status;
      updateData.updateTime = db.serverDate();
      await db.collection('products').doc(id).update({ data: updateData });
      return { success: true, message: '商品更新成功' };
    }

    case 'toggleProductStatus': {
      const { id, status } = event;
      if (!id || !['on', 'off'].includes(status)) {
        return { success: false, error: '参数错误' };
      }
      await db.collection('products').doc(id).update({
        data: { status, updateTime: db.serverDate() }
      });
      return { success: true, message: status === 'on' ? '已上架' : '已下架' };
    }

    case 'deleteProduct': {
      const { id } = event;
      if (!id) return { success: false, error: '商品ID不能为空' };
      // 检查是否有订单引用该商品（简单检查）
      const orderCount = await db.collection('orders')
        .where({ 'items.productId': id }).count();
      if (orderCount.total > 0) {
        return { success: false, error: '该商品已有订单，无法删除，建议下架' };
      }
      await db.collection('products').doc(id).remove();
      return { success: true, message: '商品已删除' };
    }

    case 'bannerList': {
      const res = await db.collection('banners')
        .orderBy('sort', 'asc')
        .get()
        .catch(() => ({ data: [] }));
      return { success: true, data: res.data || [] };
    }

    case 'createBanner': {
      const { imageUrl, linkUrl, title, sort, status } = event;
      if (!imageUrl) {
        return { success: false, error: '图片链接不能为空' };
      }
      const res = await db.collection('banners').add({
        data: {
          imageUrl: imageUrl.trim(),
          linkUrl: linkUrl || '',
          title: title || '',
          sort: Number(sort) || 0,
          status: status || 'on',
          createTime: db.serverDate()
        }
      });
      return { success: true, bannerId: res._id, message: '轮播图创建成功' };
    }

    case 'updateBanner': {
      const { id, imageUrl, linkUrl, title, sort, status } = event;
      if (!id) return { success: false, error: 'ID不能为空' };
      const updateData = {};
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl.trim();
      if (linkUrl !== undefined) updateData.linkUrl = linkUrl;
      if (title !== undefined) updateData.title = title;
      if (sort !== undefined) updateData.sort = Number(sort) || 0;
      if (status !== undefined) updateData.status = status;
      await db.collection('banners').doc(id).update({ data: updateData });
      return { success: true, message: '轮播图更新成功' };
    }

    case 'toggleBanner': {
      const { id, status } = event;
      if (!id || !['on', 'off'].includes(status)) {
        return { success: false, error: '参数错误' };
      }
      await db.collection('banners').doc(id).update({
        data: { status }
      });
      return { success: true, message: status === 'on' ? '已启用' : '已禁用' };
    }

    case 'deleteBanner': {
      const { id } = event;
      if (!id) return { success: false, error: 'ID不能为空' };
      await db.collection('banners').doc(id).remove();
      return { success: true, message: '已删除' };
    }

    // ===== 商城编辑器进阶功能 =====
    case 'cloneProduct': {
      const { id } = event;
      if (!id) return { success: false, error: '商品ID不能为空' };
      const src = await db.collection('products').doc(id).get().catch(() => null);
      if (!src || !src.data) return { success: false, error: '原商品不存在' };
      const { _id, createTime, updateTime, ...rest } = src.data;
      const cloned = await db.collection('products').add({
        data: {
          ...rest,
          name: (rest.name || '未命名商品') + ' (副本)',
          sales: 0,
          status: 'off',
          draft: true,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      return { success: true, productId: cloned._id, message: '已复制为草稿' };
    }

    case 'batchUpdateCategory': {
      const { ids, category } = event;
      if (!Array.isArray(ids) || ids.length === 0) return { success: false, error: '请选择商品' };
      const cmd = db.command;
      await db.collection('products').where({ _id: cmd.in(ids) }).update({
        data: { category: category || '', updateTime: db.serverDate() }
      });
      return { success: true, count: ids.length };
    }

    case 'batchUpdateSort': {
      const { items } = event;
      if (!Array.isArray(items) || items.length === 0) return { success: false, error: '无排序数据' };
      const promises = items.map((it) => db.collection('products').doc(it.id).update({
        data: { sort: Number(it.sort) || 0, updateTime: db.serverDate() }
      }));
      await Promise.all(promises);
      return { success: true, count: items.length };
    }

    case 'saveDraftProduct': {
      const { name, subtitle, price, originalPrice, stock, specs, images, description, category, status } = event;
      const res = await db.collection('products').add({
        data: {
          name: (name || '未命名草稿').trim(),
          subtitle: subtitle || '',
          price: Number(price) || 0,
          originalPrice: Number(originalPrice) || 0,
          stock: Number(stock) || 0,
          specs: Array.isArray(specs) ? specs : [],
          images: Array.isArray(images) ? images : [],
          description: description || '',
          category: category || '',
          status: status || 'off',
          draft: true,
          sales: 0,
          rating: 5.0,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      return { success: true, productId: res._id, message: '草稿已保存' };
    }

    case 'getProductStats': {
      const all = await db.collection('products').orderBy('createTime', 'desc').limit(1000).get();
      const list = all.data || [];
      const total = list.length;
      const on = list.filter((p) => p.status === 'on' && !p.draft).length;
      const off = list.filter((p) => p.status === 'off' && !p.draft).length;
      const drafts = list.filter((p) => p.draft).length;
      const topSales = [...list]
        .filter((p) => (p.sales || 0) > 0)
        .sort((a, b) => (b.sales || 0) - (a.sales || 0))
        .slice(0, 10)
        .map((p) => ({
          _id: p._id,
          name: p.name,
          sales: p.sales || 0,
          stock: p.stock || 0,
          priceText: ((p.price || 0) / 100).toFixed(2)
        }));
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const stale = list.filter((p) => {
        if (p.status !== 'on' || p.draft || (p.sales || 0) > 0) return false;
        const t = p.createTime ? new Date(p.createTime).getTime() : now;
        return (now - t) > THIRTY_DAYS;
      }).slice(0, 10).map((p) => ({
        _id: p._id,
        name: p.name,
        stock: p.stock || 0,
        createTimeText: p.createTime ? new Date(p.createTime).toISOString().slice(0, 10) : '-'
      }));
      const byCategoryMap = {};
      list.forEach((p) => {
        const c = p.category || '未分类';
        byCategoryMap[c] = (byCategoryMap[c] || 0) + 1;
      });
      const byCategory = Object.keys(byCategoryMap)
        .map((k) => ({ name: k, count: byCategoryMap[k] }))
        .sort((a, b) => b.count - a.count);
      return { success: true, data: { total, on, off, drafts, topSales, stale, byCategory } };
    }

    case 'exportProducts': {
      const { filter = 'all' } = event;
      let query = {};
      if (filter === 'on') query = { status: 'on', draft: _.neq(true) };
      else if (filter === 'off') query = { status: 'off', draft: _.neq(true) };
      else if (filter === 'draft') query = { draft: true };
      const all = await db.collection('products').where(query).orderBy('createTime', 'desc').limit(1000).get();
      const rows = [['ID', '名称', '分类', '售价(元)', '原价(元)', '库存', '已售', '状态', '草稿', '创建时间']];
      (all.data || []).forEach((p) => {
        const statusLabel = p.draft ? '草稿' : (p.status === 'on' ? '上架' : '下架');
        rows.push([
          p._id || '',
          p.name || '',
          p.category || '',
          ((p.price || 0) / 100).toFixed(2),
          ((p.originalPrice || 0) / 100).toFixed(2),
          String(p.stock || 0),
          String(p.sales || 0),
          statusLabel,
          p.draft ? '是' : '否',
          p.createTime ? new Date(p.createTime).toISOString() : ''
        ]);
      });
      const escape = (v) => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = '\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\n');
      return { success: true, data: { csv, count: rows.length - 1, filter } };
    }

    // ===== Web 后台专用：消息管理 =====
    case 'messageUsers': {
      if (!isAdmin) return { success: false, error: '无管理员权限' };
      const allMsgs = await db.collection('messages')
        .orderBy('createTime', 'desc')
        .limit(500)
        .get();
      const userMap = {};
      for (const msg of allMsgs.data) {
        const uid = msg.isAdmin ? msg.targetId : (msg.fromId === 'admin' ? msg.targetId : msg.fromId);
        if (!uid || uid === 'admin') continue;
        if (!userMap[uid]) {
          userMap[uid] = {
            userOpenId: uid,
            lastContent: msg.content,
            lastTime: msg.createTime,
            unread: 0,
            nickName: '用户',
            avatarUrl: ''
          };
        }
        if (!msg.isAdmin && !msg.read) {
          userMap[uid].unread++;
        }
      }
      const userIds = Object.keys(userMap);
      for (const uid of userIds) {
        const userRes = await db.collection('users').where({ openId: uid }).get().catch(() => null);
        if (userRes && userRes.data && userRes.data[0]) {
          userMap[uid].nickName = userRes.data[0].nickName || '用户';
          userMap[uid].avatarUrl = userRes.data[0].avatarUrl || '';
        }
      }
      return { success: true, data: Object.values(userMap) };
    }

    case 'messageHistory': {
      if (!isAdmin) return { success: false, error: '无管理员权限' };
      const { userOpenId } = event;
      if (!userOpenId) return { success: false, error: '缺少用户ID' };
      const fromUser = await db.collection('messages')
        .where({ fromId: userOpenId })
        .orderBy('createTime', 'asc')
        .limit(200)
        .get();
      const toUser = await db.collection('messages')
        .where({ targetId: userOpenId })
        .orderBy('createTime', 'asc')
        .limit(200)
        .get();
      const allMsgs = [...fromUser.data, ...toUser.data];
      // 去重（两条查询可能返回同一条消息）
      const seen = new Set();
      const deduped = allMsgs.filter(m => {
        if (seen.has(m._id)) return false;
        seen.add(m._id);
        return true;
      });
      deduped.sort((a, b) => new Date(a.createTime) - new Date(b.createTime));
      return { success: true, data: deduped };
    }

    case 'adminReply': {
      const { userOpenId, content } = event;
      if (!userOpenId || !content) return { success: false, error: '参数不完整' };
      await db.collection('messages').add({
        data: {
          fromId: 'admin',
          targetId: userOpenId,
          content: content,
          type: 'text',
          isAdmin: true,
          read: false,
          createTime: db.serverDate()
        }
      });
      return { success: true, message: '发送成功' };
    }

    // ===== Web 后台专用：设置管理 =====
    case 'getSettings': {
      return {
        success: true,
        settings: {
          adminOpenIds: configData.adminOpenIds || (legacyOpenId ? [legacyOpenId] : []),
          passwordSet: !!configData.password,
          commissionRate: configData.commissionRate || 0.15
        }
      };
    }

    case 'setCommissionRate': {
      const { commissionRate } = event;
      const rate = Number(commissionRate);
      if (isNaN(rate) || rate < 0 || rate > 1) {
        return { success: false, error: '佣金比例必须在 0~1 之间' };
      }
      await db.collection('admin_config').doc('admin').update({
        data: { commissionRate: rate }
      });
      return { success: true, message: '佣金比例已更新为 ' + Math.round(rate * 100) + '%' };
    }

    case 'changePassword': {
      const { oldPassword, newPassword } = event;
      if (!newPassword || newPassword.length < 6) {
        return { success: false, error: '新密码至少6位' };
      }
      if (configData.password && !verifyPassword(oldPassword || '', configData.password)) {
        return { success: false, error: '原密码错误' };
      }
      await db.collection('admin_config').doc('admin').update({
        data: { password: hashPassword(newPassword) }
      });
      return { success: true, message: '密码已更新' };
    }

    case 'addAdminOpenId': {
      const { openId: newOpenId } = event;
      if (!newOpenId) return { success: false, error: 'openId不能为空' };
      const current = configData.adminOpenIds || (legacyOpenId ? [legacyOpenId] : []);
      if (current.includes(newOpenId)) {
        return { success: false, error: '该openId已存在' };
      }
      current.push(newOpenId);
      await db.collection('admin_config').doc('admin').update({
        data: { adminOpenIds: current }
      });
      return { success: true, message: '已添加管理员' };
    }

    case 'removeAdminOpenId': {
      const { openId: removeId } = event;
      const current = configData.adminOpenIds || [];
      const newList = current.filter(id => id !== removeId);
      await db.collection('admin_config').doc('admin').update({
        data: { adminOpenIds: newList }
      });
      return { success: true, message: '已移除管理员' };
    }

    default:
      return { success: false, error: 'unknown action' };
  }
  } catch (err) {
    console.error('[admin] 运行时错误:', err);
    return {
      success: false,
      error: '云函数执行失败'
    };
  }
};
