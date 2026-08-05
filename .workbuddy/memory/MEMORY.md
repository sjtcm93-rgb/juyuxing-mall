# 橘与杏商城 — 项目长期记忆

## 项目基本信息
- AppID: wx6e685f787f1cd099
- 云环境 ID: cloud1-d4gx1jxk675274501
- 微信支付商户号: 1114186048（商户号已绑定，待 pay_config.useMockPay=false 切真实支付；当前仍走 mock）
- 项目路径: /Users/orange/Documents/橘与杏商城/

## 技术架构
- 微信原生小程序 + 云开发
- 17 个云函数: init, login, product, cart, order, pay, payNotify, agent, commission, withdrawal, admin, category, chat, coupon, favorite
- 24 个前端页面
- admin-web: 独立 HTML/JS/CSS 管理后台

## 关键设计决策
- 佣金比例: 从硬编码 0.15 改为从 admin_config 动态读取（默认 0.15）
- Mock 支付模式: pay 云函数直接落 paid + 创建佣金，不走 payNotify 回调
- payNotify 仅用于真实微信支付回调 + 幂等性验证
- 管理员权限: admin_config.admin 文档的 adminOpenIds 数组 + openId 字段（兼容）
- admin-web 登录: 密码哈希(SHA-256) + webToken(24h过期)

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
