# 多管理员与内容审批实现计划

**目标：** 实现超级管理员、普通管理员及内容审批。
**架构：** 原生 Node API 负责鉴权，版本化 JSON 账号集合与审批记录原子存储。现有后台按角色显示功能，后台与数据存储分工并行实现。
**技术栈：** Node.js、HTML、CSS、JavaScript，无新增依赖。
**规格：** ../specs/2026-10-10-admin-approval-design.md

## 全局约束

保留原账号密码及正式文章；测试使用临时 data；部署包排除账号及申请。

## 审查重点

过期或禁用账号在等待请求体后仍然提交；多次并发审批；已修改目标的删除审批；密码修改注销其他账号；损坏数据触发重新设置。

## 任务

- [x] 账号模型：`lib/accounts.mjs`、`lib/auth.mjs`、`tests/accounts.test.js`，验证旧账号无损迁移、数据校验、按用户失效。
- [x] 后端流程：`lib/store.mjs`、`lib/requests.mjs`、`server.mjs`、`tests/permissions.test.js`，先测试红灯，再实现权限、账号 CRUD 与审批事务。
- [x] 后台界面：`admin.js`、`admin.html`、`admin.css`、`admin-management.js`，增加账号管理、审批及普通管理员提示，保留现有草稿保护。
- [x] 完整验证：`npm test` 91/91；浏览器普通发布/删除申请、super 审批；390px/1280px 文档宽度均无溢出；独立审查无阻断项。
- [x] 更新部署清单、中文说明；build/package/构建服务启动通过，首次 super 与新增 admin 通过；ZIP 45 文件、35.2 MiB，仅文章与配置数据。
- [x] 正式服务 PID 29972，旧账号 superadmin、盐与 hash 保留，文章与网站内容 SHA-256 不变；交付新版 ZIP。
