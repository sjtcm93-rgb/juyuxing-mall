# 橘与杏中医生活 — 部署与联调指南

> 本指南按"从零到能下单"的顺序列出所有步骤。每一步都要在前一步完成后做。

---

## 0. 一键自检（不依赖云开发）

在动手部署之前，先跑一次本地 smoke test，把静态结构和关键业务规则过一遍：

```bash
node scripts/smoke-test.js
```

预期输出 `通过: 117 / 失败: 0`。CI 或 git hook 里都可以跑这一步。

---

## 1. 准备账号

| 事项 | 说明 | 状态 |
|------|------|------|
| 微信开发者工具 | 已安装（`wechatwebdevtools.app`） | ✅ |
| Node.js v22 | 已安装 | ✅ |
| 小程序 AppID | `wx6e685f787f1cd099`（已写入 `project.config.json`） | ✅ |
| 云开发环境 ID | `cloud1-d4gx1jxk675274501`（已写入 `app.js` / `cloudbaserc.json`） | ✅ |
| 微信支付商户号 | **需你自行申请** | ❌ |

> 没开通支付商户号时，支付走**模拟模式**（订单直接置为 `paid`），不影响其他流程验证。

---

## 2. 安装云函数依赖

```bash
bash scripts/setup.sh
```

会自动检查每个云函数的 `node_modules`，缺哪个就 `npm install --production`。

---

## 3. 在微信开发者工具里打开项目

```bash
open -a "wechatwebdevtools.app" "/Users/orange/Documents/橘与杏商城"
```

或在开发者工具里手动 **导入项目 → 项目目录选 `/Users/orange/Documents/橘与杏商城`**。

---

## 4. 创建数据库集合

在微信开发者工具 → **云开发** → **数据库**，创建以下 8 个集合：

```
users          — 用户表
products       — 商品表
orders         — 订单表
cart           — 购物车
addresses      — 收货地址
commissions    — 佣金记录
withdrawals    — 提现申请
admin_config   — 管理后台配置（固定文档 _id=admin）
```

`database-indexes.json` 里规划了索引，建议按集合导入。

---

## 5. 部署云函数

在微信开发者工具的 **cloudfunctions/** 目录上右键，**上传并部署：云端安装依赖**（首次），后续可勾选**不上传 node_modules**。

建议顺序：

```
init → login → product → cart → order → pay → agent → commission → withdrawal → admin
```

---

## 6. 初始化数据

云开发控制台 → 云函数 → `init` → **云端测试**：

```json
{ "action": "init" }
```

预期返回：

```json
{
  "success": true,
  "message": "初始化完成",
  "productId": "xxxx",
  "adminCreated": true
}
```

这会创建默认商品「小紫瓶」和管理员配置占位文档。

再用 `check` 动作确认：

```json
{ "action": "check" }
```

应该看到 `productCount: 1`、`adminConfigured: true`、`adminOpenIdSet: false`。

---

## 7. 设置管理员 openId

1. 用微信开发者工具预览小程序（**真机或开发者工具自带二维码都行**）
2. 在"我的"页点击登录，会调一次 `login` 云函数
3. 在云开发控制台 → **数据库 → users** 集合，找到刚生成的文档，复制它的 `_id`（即该用户的 openId）
4. 进入 **admin_config** 集合 → 文档 `_id='admin'` → 编辑 `openId` 字段为刚复制的 openId

> 注意：admin_config 的 `_id` 必须是 `admin`，否则 `admin` 云函数会判定无权限。

---

## 8. 跑一遍完整流程

在开发者工具里走一遍：

| 步骤 | 期望 |
|------|------|
| 首页 → 看到小紫瓶 | ✅ 显示「热卖单品」卡片 |
| 点击商品 → 详情 | ✅ 图片轮播 / 价格 / 加入购物车 |
| 加入购物车 → 进入购物车 | ✅ 列表显示商品 + 合计 |
| 立即购买 → 进入结算 | ✅ 地址为空时引导添加 |
| 添加地址 → 提交订单 | ✅ 跳到订单详情 |
| 订单详情 → 模拟支付 | ✅ 状态变为「已支付」 |
| 我的 → 进入管理后台 | ✅ 看到仪表盘统计 |

### 验证代理链路

1. 进入「我的」→「成为代理」→ 填写资料提交
2. 在 **admin 后台 → 代理审核** 通过该申请
3. 「我的」里出现「代理中心」
4. 用另一个微信账号扫码（开发者工具 → 预览 → 右上角菜单 → 添加编译模式 → 启动参数 `?ref=<代理 openId>`）→ 注册后该用户 `users.referrer` 应为代理的 openId
5. 用该用户下单并支付 → `orders.agentId` 应等于代理 openId，且 commissions 集合新增一条 `status: 'pending'` 的佣金记录

### 验证提现链路

1. 管理后台 → 「订单管理」选一条已支付订单 → 标记发货（订单状态 → `shipped`）
2. 切回 `admin` 云函数调试，手动把对应 commissions 标记为 `settled`（调用 `commission` 云函数 `{ action: 'settle', commissionId: '...' }`）
3. 代理用户 → 代理中心 → 提现 → 提交
4. 管理后台 → 「提现审核」→ 通过 → `withdrawals.status` 变为 `approved`，对应 commissions 标记为 `paid`
5. 再次查看代理余额，已发放部分不应再可提现（修复后行为）

---

## 9. 上线前检查

- [ ] 微信支付商户号申请完成 + 接入 `pay` 云函数（替换模拟逻辑）
- [ ] 商品真实图片替换 `images` 字段（init 函数里的 `images: []`）
- [ ] 修改 `commission/index.js` 和 `order/index.js` 中的 `COMMISSION_RATE`（如需调整）
- [ ] 提交代码 → 微信开发者工具 → 上传 → 提交审核

---

## 10. 修复日志（最近一次）

| 文件 | 修复内容 |
|------|---------|
| `cloudfunctions/init/index.js` | 重写：提取 `ensureAdminConfig`，保证任何初始化分支都会创建 admin_config |
| `cloudfunctions/admin/index.js` | `processWithdrawal` 通过时按时间顺序消费 settled 佣金并标记为 `paid`，防止重复提现 |
| `cloudfunctions/order/index.js` | `create` 增加入参校验、商品上下架校验、库存校验、服务端重算总价；下单后清空购物车；提取 `COMMISSION_RATE` 常量 |
| `cloudfunctions/pay/index.js` | 重构：复用 `order.updateStatus` 处理状态变更和佣金创建；增加订单归属校验 |
| `cloudfunctions/agent/index.js` | `apply` 增加重复申请 / 已是代理 / 待审核的防护 |
| `miniprogram/pages/agent-join/agent-join.js` | 显示后端返回的错误信息 |
| `miniprogram/pages/checkout/checkout.js` | 支付异常时改用 `switchTab` 跳订单列表（之前用 `redirectTo` 跳 tabBar 页会失败） |
| `scripts/smoke-test.js` | 新增：本地静态检查 + 业务规则单元测试，117 项检查 |
| `scripts/setup.sh` | 已存在：依赖检查 + 部署指引 |

---

## 11. 已知遗留问题（不影响 MVP 验证）

- 购物车多商品时跳结算只取第一个 SKU 进 checkout 页——目前只有 1 个商品无影响，后续多 SKU 时需重构结算页支持多 item
- `pages/user/user.js` 在每次 `onShow` 都调 `admin` 云函数判权限——返回 `false` 是预期，仅浪费一次调用，后续可改为只在登录后调一次
- `index.js`、`product.js`、`checkout.js` 都有前端 `DEFAULT_PRODUCT` 降级方案——云环境未启动时会展示假数据但下单会失败，未来可去掉改用纯空状态
- 售后/退款申请入口尚未添加（订单有 `refunding`/`refunded` 状态但前端无操作按钮）
- 真实快递查询未对接（logistics 页只展示后端写入的物流信息）

---

## 12. 关键不变量（改动前请确认）

| 常量 | 位置 | 值 |
|------|------|-----|
| 佣金比例 | `order/index.js` `COMMISSION_RATE` | `0.15` |
| 最低提现 | `withdrawal/index.js` | `1000` 分（10 元） |
| 推广码格式 | `agent/index.js` | `JY` + OPENID 末 6 位 |
| 价格单位 | 数据库 | 分（整数） |

`scripts/smoke-test.js` 会对这些常量做断言，改动后跑一次确保没破坏。
