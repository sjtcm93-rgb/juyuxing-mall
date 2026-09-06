# 微信扫码登录管理后台 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 使用现有微信小程序 AppID，为 B 端管理后台增加一次性小程序码扫码确认登录，并在确认后签发 24 小时后台会话。

**Architecture:** 新增独立 `adminQrAuth` 云函数承载匿名网页创建/轮询票据和小程序端确认，避免把扫码票据逻辑混入业务后台函数。网页先匿名访问窄权限的扫码认证函数，确认成功后用 CloudBase 自定义登录 Ticket 切换为非匿名身份，再携带现有 `adminToken` 调用 `admin`；`admin` 云函数继续使用账号会话和 RBAC。小程序新增无菜单入口的确认分包页，只向已绑定后台账号或旧管理员 OpenID 展示确认按钮。

**Tech Stack:** 微信小程序、CloudBase 云函数与文档数据库、`wx-server-sdk`、`@cloudbase/node-sdk`、CloudBase Web SDK 2.x、Vue 3。

---

### Task 1: 锁定扫码票据和身份规则

**Files:**
- Create: `cloudfunctions/adminQrAuth/ticket-core.js`
- Test: `scripts/admin-qr-auth-test.js`

**Steps:**
1. 为随机 publicId、轮询密钥哈希、两分钟过期、一次性状态迁移编写失败测试。
2. 运行 `node scripts/admin-qr-auth-test.js`，确认测试先失败。
3. 实现纯函数校验，拒绝过期、重复消费、无效场景参数。
4. 重跑测试并确认通过。

### Task 2: 实现扫码认证云函数

**Files:**
- Create: `cloudfunctions/adminQrAuth/index.js`
- Create: `cloudfunctions/adminQrAuth/package.json`
- Create: `cloudfunctions/adminQrAuth/package-lock.json`
- Modify: `cloudbaserc.json`

**Steps:**
1. 实现 `createQrLogin`：创建两分钟票据并生成指向确认页的小程序码，返回 base64 图片和轮询密钥。
2. 实现 `inspectQrLogin`、`confirmQrLogin`：使用调用方微信 OpenID 解析后台账号，兼容旧 `admin_config` 管理员并安全绑定首个 owner。
3. 实现 `pollQrLogin`：校验轮询密钥，事务式消费已确认票据，签发 CloudBase 自定义登录 Ticket 和现有格式的 24 小时 `adminToken`。
4. 私钥只从云函数环境变量读取；缺失时返回明确配置提示，绝不提交凭据。
5. 将 `adminQrAuth` 加入 CloudBase 部署清单。

### Task 3: 新增小程序扫码确认页

**Files:**
- Create: `miniprogram/subpackages/admin-auth/confirm/confirm.js`
- Create: `miniprogram/subpackages/admin-auth/confirm/confirm.json`
- Create: `miniprogram/subpackages/admin-auth/confirm/confirm.wxml`
- Create: `miniprogram/subpackages/admin-auth/confirm/confirm.wxss`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/utils/api.js`

**Steps:**
1. 注册独立 `admin-auth` 分包，不在 A 端菜单暴露入口。
2. 解析小程序码 `scene`，加载票据和当前后台账号摘要。
3. 用户必须主动点击“确认登录”；无后台角色、过期或已使用票据均拒绝。
4. 增加加载、成功、失败和过期界面。

### Task 4: 改造 Web 管理后台登录页

**Files:**
- Modify: `admin-web/app.js`
- Modify: `admin-web/index.html`
- Modify: `admin-web/style.css`

**Steps:**
1. 登录页默认请求扫码票据并显示小程序码、倒计时和刷新按钮。
2. 每两秒轮询一次；页面隐藏、离开登录页或组件卸载时停止轮询。
3. 确认后调用 `signInWithCustomTicket` 切换 CloudBase 登录身份，保存 24 小时后台会话并加载看板。
4. 退出登录时同时撤销后台会话和 CloudBase 自定义登录态。
5. 保留清晰的配置错误，不再显示 SDK 内部 `scope` 或原始 JSON。

### Task 5: 数据索引、迁移兼容与部署说明

**Files:**
- Modify: `database-indexes.json`
- Modify: `cloudfunctions/admin/index.js`
- Modify: `docs/ABC-DEPLOYMENT.md`
- Modify: `README.md`

**Steps:**
1. 新增 `admin_login_tickets` 的 publicId 唯一索引、状态/过期索引和轮询密钥唯一索引。
2. 后台账号列表只返回 `wechatBound` 布尔值，不返回 OpenID。
3. 记录用户手动步骤：启用自定义登录、把私钥三字段放入云函数环境变量、部署 `adminQrAuth`、创建集合/索引。
4. 记录最小安全规则：默认拒绝匿名调用，只有 `adminQrAuth` 允许 `auth != null`；匿名角色仅增加云函数网关能力，业务数据仍由函数内校验。

### Task 6: 自动化验证

**Files:**
- Modify: `scripts/e2e-mock.js`
- Modify: `scripts/smoke-test.js`
- Modify: `scripts/page-load-logic-test.js`

**Steps:**
1. Mock 覆盖：非管理员扫码拒绝、旧 owner 自动绑定、过期票据拒绝、一次性消费、重复轮询不重复签发会话。
2. 静态检查确认确认页无 A 端入口、私钥未硬编码、后台二维码轮询可清理。
3. 运行 `node scripts/admin-qr-auth-test.js`。
4. 运行 `npm run smoke`、`node scripts/e2e-mock.js`、`npm run lint:functions` 和 `node scripts/page-load-logic-test.js`。
5. 不调用真实支付、不执行数据迁移、不上传发布；云函数部署和私钥配置由用户在控制台完成。
