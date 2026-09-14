# 橘与杏商城 — 项目长期记忆

## 项目基本信息
- AppID: wx6e685f787f1cd099
- 云环境 ID: cloud1-d4gx1jxk675274501
- 微信支付商户号: 1114186048（真实支付已开通并验证，payNotify 回调链路已修复，2026-09-13）
- 项目路径: /Users/orange/Documents/橘与杏商城/

## 技术架构
- 微信原生小程序 A 端 + B 端 admin-web + C 端代理分销分包，三端架构
- 23 个云函数（含 init/login/product/cart/order/pay/payNotify/agent/commission/withdrawal/admin/category/chat/coupon/favorite/promotion/maintenance/adminQrAuth/refund-processor/admin-refund-http 退役/uploadProductImage/updateProductDesc）
- A 端主包精简（移除分销/后台/店铺编辑入口）
- C 端 subpackages/distributor（仅 B 端邀请激活）
- B 端 admin-web（admin_owner/admin_operator/admin_finance 三角色权限隔离）

## 关键设计决策
- A/B/C 三端架构：消费者精简 / 后台扫码登录 / 代理邀请激活
- 佣金比例：从 admin_config 动态读取（默认 33%，commission-policy-test 验证）
- 支付：useMockPay=false + ALLOW_MOCK_PAY=false 双开关；mock 需同时开启才生效
- 退款一致性：申请 → 同意 pending_auto → 店主/财务扫码 → queryRefundStatus 只读 → 微信 SUCCESS 后事务同步
- 旧 admin-refund-http 已退役返回 410 REFUND_ENDPOINT_RETIRED
- 管理员权限：数据库账号体系 + 角色字段；admin_operator 不能审提现 / admin_finance 不能改商品库存 / 仅 admin_owner 管账号；历史 admin_config.adminOpenIds 已不再用于登录
- B 端登录：匿名登录 + adminQrAuth 自定义登录 Ticket；2 分钟票据；二维码先落主包首页再中转 subpackages/admin-auth/confirm/confirm
- ALLOW_ADMIN_BOOTSTRAP 环境变量已失效，店主账号必须在数据库迁移或账号管理流程中绑定 wechatOpenId

## 测试体系
- scripts/smoke-test.js: 156 项静态检查 + 业务规则验证
- scripts/e2e-mock.js: 57 项端到端全链路验证（登录→加购→下单→支付→佣金→提现→退款→权限）
- 测试已知约束: e2e-mock 需手动设置 mock-agent-A 为管理员

## 开发阶段规划
- 阶段一（已完成）: 修复 E2E/Smoke/init 阻塞问题
- 阶段二: 购物车多商品结算、退款前端UI、性能优化
- 阶段三（进行中）: 接入微信支付（商户绑定✅、切真实支付代码就绪✅、隐私合规代码✅）、替换商品图片、提交审核
- 阶段四: 代理等级、拼团、会员等级、企业微信私域
- admin-web 已补全代理管理/提现审批/退款管理三个页面（云函数接口原有，前端调用新增）；佣金比例可界面保存

## 用户协作偏好
- 用户非技术背景，微信后台控制台导航需极细化的"点哪、看到什么"级指引。
- agent 无法代操作微信/腾讯云控制台（需本人账号+扫码）；采用"用户点一步、agent 指一步"的陪走模式。
- 注意区分两个产品：腾讯云 console.cloud.tencent.com/tcb（独立 CloudBase）≠ 微信内置云开发（微信开发者工具/mp 后台「云开发」，环境 cloud1-d4gx1jxk675274501）。

## 云开发自动化能力（2026-09-12 验证）
- 开发者工具 CLI：/Applications/wechatwebdevtools.app/Contents/MacOS/cli（需 IDE 运行中；HTTP 服务 127.0.0.1:16285）
- 常用：islogin / cloud env list / cloud functions list|deploy --env cloud1-d4gx1jxk675274501 --names <fn> --project <项目路径> --remote-npm-install / auto --auto-port 9420
- miniprogram-automator 装于 /Users/orange/.workbuddy/binaries/node/workspace，连接 ws://localhost:9420 可 evaluate 调用 wx.cloud.callFunction/database（异步 Promise 已验证可用）
- 部署新函数若报 "Creating 状态" 错误，等 20 秒重试即成功（首次已在创建）
- **⚠️ CLI 部署重置超时的坑（两次真机事故）：`cli cloud functions deploy` 不应用 cloudbaserc 且把函数超时重置为默认 3 秒。每次 CLI 部署任何函数后必须立即用 MCP updateFunctionConfig 补设超时（标准值见 cloudbaserc：product/banner/login/category/favorite/cart=5s，coupon/chat/order/pay/agent/commission/withdrawal/admin=10s，payNotify/adminQrAuth/promotion=20s，maintenance=30s，refund-processor=60s）。2026-09-13 已全量核验修正。**
- 2026-09-13 关键修复：微信云支付服务商模式回调 event 字段为驼峰且 event.openid 是平台侧标识、event.subOpenid 才是小程序侧用户标识（与订单 userId 同源）——payNotify 已修正并加回调留痕 paynotify_events；数据清空后最新备份：云存储 backups/db-backup-2026-09-13T09-12-44-873Z.json（135 文档）
- **2026-09-14 关键能力：云函数自触发（admin 退款用）**——云开发支付的服务商订单退款必须带小程序票据调用 cloudPay；B端网页/直调都没有票据（-501001）。解法：AppSecret（admin env MINIPROGRAM_APPSECRET）换 stable_token → `api.weixin.qq.com/tcb/invokecloudfunction` 触发的调用上下文（SOURCE=wx_http）cloudPay 可用（已实测）。admin 的 processRefund/retryRefund 均走此链路。
- wx-server-sdk 嵌套坑：update 里写嵌套对象会被展平成点路径，null 字段上建子字段报 Cannot create field——整体替换用 `_.set()`；订单类文档避免写 `字段: null` 占位
- MCP updateFunctionCode 部署不重置超时/环境变量（与 CLI 相反），优先用 MCP 部署云函数
- 退款 UX：B端点「同意」即自动执行；「待人工核查」单据有「重试退款」按钮（微信按 outRefundNo 幂等）；商户基本账户余额不足会拒退（新商户常见：收款次日结算到卡），需商户平台充值后重试
- 数据库备份放 backups/（gitignored，含支付密钥，敏感勿外传）；当前备份：db-backup-2026-09-12T12-53-24.json（122 文档）
- 云端待清理：zz-dbinspect 临时函数（已 RETIRED 桩化，上线前控制台删除）
