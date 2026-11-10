# 全站内容管理实现计划

目标：晏阳联合政府网站可由管理员修改各区域名称和正文，并可备份迁移。

接口：schema 导出 contentFields（key/group/label/type/defaultValue/maxLength）和 defaultSiteContent={version:1,values}；公开/管理 GET 返回 {content}，PUT 请求完整配置。内部栏目键及路由保持稳定。

- [x] 门户：site-content-schema.js 定义 281 个公开文本字段，app.js 从公开 API 应用字段；index.html 加区域绑定，示例数据更名，动态详情转义。
- [x] 后端：lib/site-content.mjs 验证；store/site-content.json 持久化与原子恢复；server 公开/认证 API、备份及迁移；先红后绿 API 测试。
- [x] 管理：admin 新“网站内容”导航；admin-site-content.js 生成分组/搜索表单与保存；锁定提交、提醒未保存、失败保留输入，合并加载请求并使旧会话响应失效，重新登录同账号保留编辑。
- [x] 部署：包含 schema/admin 编辑模块/配置快照，名称更新，包隐私与快照测试；不迁移账号。
- [x] 集成：43/43 测试，独立代码审查问题已修复；隔离浏览器修改名称/内容/保存与首页和指南验证、390px 移动端、零外链审计、最终构建和 35.2 MiB 部署包完成。

审查重点：配置未知键/超长必须原子拒绝；URL/HTML文字不能变成外链/可执行内容；修改区域名称不能破坏功能路由；备份任一部分无效不得半恢复；保存失败或过程离开不得丢未保存输入。

职责：门户 agent 管 schema/app/index/portal-data；后端 agent 管 server/lib/API测试；部署 agent 管 deployment/scripts/README/部署测试；根 agent 管 admin 编辑器与最终集成验证。
