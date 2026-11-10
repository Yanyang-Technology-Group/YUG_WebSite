# 管理模式与一键部署实现计划

目标：为门户加入真实持久化的文章管理，以及适合 Windows 10/11 x64 的免安装部署包。

依据：../specs/2026-10-10-admin-deployment-design.md

- [x] 后端：Node 原生 HTTP API、账号设置、登录会话、文章 CRUD、文件存储、备份恢复；先运行失败的集成测试再实现。
- [x] 前端：管理页登录/初始化、文章列表、编辑与预览、部署/备份页、修改密码；首页改为读取公开 API，处理空栏目及新文章。
- [x] 部署：官方运行环境、含文章快照但不含凭据的 ZIP、一键启动/停止/局域网脚本，实际解压核验。
- [x] 集成：23/23 测试通过，构建与最终打包通过；隔离后台发帖、首页与详情展示、编辑/草稿、390px 后台布局、外链审计与独立复审完成。

并行职责：后端 agent 管 server/lib/API 测试；部署 agent 管 deployment/scripts/package/docs；根 agent 管 admin 页面与首页集成。

接口约束：JSON API 使用 `{articles}`，写入使用 `X-CSRF-Token`，文章状态 published/draft。首次账号设置仅本机，迁移包初始化新账号。
