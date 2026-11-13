# Cloudflare Pages 部署（3.0.2）

架构：Next.js App Router 静态导出 + 同项目 Pages Functions + Cloudflare D1。首页和 `/admin/`、`/api/*` 使用同一个域名，一次部署；无需额外 Node 服务器。前端页面模板和交互源码继续位于 `public/`，`app/` 是 Next 路由入口。

## 首次部署

1. 安装 Node.js 22 或 24，运行 `npm ci`。
2. 运行 `npx wrangler login` 登录 Cloudflare，再运行 `npx wrangler d1 create yanyang-government` 创建 D1 数据库。
3. 将返回的真实数据库 ID 填入 `wrangler.toml` 的 `database_id`，替换全零占位值。保持绑定名 `DB` 不变。
4. 运行 `npm run db:migrate:remote` 初始化远程 D1。
5. 创建 Cloudflare Pages 项目。使用 Git 集成时，构建命令填 `npm run build:pages`，输出目录填 `out`，框架预设选择 None；不要选择要求 next-on-pages 的旧 Next 预设。Node 版本使用 22 或 24。
6. Pages 项目的生产环境绑定同一个 D1 数据库，绑定名必须为 `DB`。如使用预览环境，应绑定独立数据库并执行迁移，避免预览写入生产数据。
7. 在 Pages 的环境变量/密钥设置中添加至少 32 字符的随机 `SETUP_TOKEN`，然后重新部署。不要把真实密钥写入仓库。
8. 打开 `/admin/`，输入新账号、密码及首次设置密钥，创建超级管理员。账号建立后可删除 SETUP_TOKEN 并重新部署；已有管理员正常登录。

也可在完成上述 D1 和密钥配置后，运行 `npm run deploy:pages` 通过 Wrangler 上传。此命令会先构建，再上传完整 Pages 项目及 Functions。源码已配置项目名称与 D1 数据库 ID；API 令牌和首次设置密钥均不写入仓库。

3.0.1 起，构建会编译根目录 functions/，将单文件后台 out/_worker.js 与 out/_routes.json 一起放入输出。上传整个 out/ 即可包含前后端；旧版本仅上传静态 out/ 会使 /api/* 返回 HTML 404。上传后仍须配置 nodejs_compat、D1 和首次设置密钥。

## Cloudflare 直接拉取 GitHub 自动部署

项目 yug-website-git 连接 Yanyang-Technology-Group/YUG_WebSite 的 main 分支。Cloudflare 在收到推送后直接拉取仓库、构建、发布，不使用 GitHub Actions。

- 生产分支：main。
- 框架预设：None；构建命令：npm run build:pages；输出目录：out；根目录：仓库根目录。
- 构建环境变量：NODE_VERSION=24。
- 运行兼容日期：2026-11-09；兼容标志：nodejs_compat。
- D1 绑定名：DB；值选择 yanyang-government 数据库（ID：1398b31b-9e7f-413b-b253-746c7367894a）。
- SETUP_TOKEN 使用 Pages 的加密变量，不写入 GitHub。首次创建超级管理员时使用，之后可删除并重新部署。
- 预览自动部署关闭，防止预览版本写入生产 D1。未来开启预览时应使用独立数据库。

原 yug-website 为 Direct Upload 项目，Cloudflare 不支持将它转换为 Git 集成项目。因此保留旧项目，并在新项目构建和接口验证通过后将 gov.yanyn.cn 切换过去。Git 仓库不包含离线模型、Python 运行环境、私有 data/、历史部署包或密钥。Pages 不需要这些离线资源。

远程迁移只需要在数据库首次初始化或增加迁移文件时执行：npm run db:migrate:remote。自动构建不注入 Cloudflare 管理令牌，避免将账户管理权限交给站点运行环境。

## 直接上传 out 的控制台配置

在现有 Pages 项目设置中启用 nodejs_compat（兼容日期不早于 2024-09-23），添加 D1 数据库绑定：变量名称填 DB，值选择 yanyang-government；不是把数据库 ID 当作普通环境变量。首次使用前运行数据库迁移，或仅在空数据库的 D1 控制台执行 migrations/0001_initial.sql。添加至少 32 字符的 SETUP_TOKEN 后，重新上传完整 out/。

部署后 /api/admin/session 应返回 JSON；缺少 DB 时返回明确的 JSON 503，返回 HTML 404 则应检查是否漏传 _worker.js/_routes.json。管理页会显示具体提示。控制台拖放支持单文件 _worker.js，但不会替你编译源码 functions/ 文件夹。

## 内容与隐私

构建从本机 `data/articles.json` 和 `data/site-content.json` 读取内容快照；不存在时使用示例内容。只将已发布文章及网站区域文字放入 `out/portal-seed.json`。这些本来就是公开内容；草稿、账号、QQ、留言、审批、日志、会话和翻译密钥均不会进入静态产物。首次 API 请求通过 D1 绑定参数导入快照，避免大篇文章触发 SQL 字面量长度限制。数据库初始化后，重新发布站点不会覆盖线上后台修改。

若使用 Git 构建，私有 data/ 已在 .gitignore 中排除，因此云端初始快照是示例内容。需要发布本机当前公开内容时，先在本机运行 `npm run build:pages`，再通过 Wrangler 上传；或在初始化后使用受认证保护的内容导入 API。请不要为了云端构建提交整个 data/。

D1 使用原子批次和修订号检查，多个实例同时更新不会悄悄覆盖内容；持续冲突时返回 409，刷新后重试。Pages 新账号使用 Web Crypto PBKDF2-SHA512；本地 Node 部署继续使用 scrypt，校验兼容两种格式。会话持久化并在密码或权限变化时失效，HTTPS Cookie 带 Secure、HttpOnly 和 SameSite=Strict。

## Pages 运行边界

- Pages 没有常驻计时器：定时文章在到期后的下一次 API 请求中发布。若需要无人访问时精确触发，可另配 Cloudflare 定时 Worker 调用公开文章接口。
- Pages 不运行本机 Python 离线模型。后台可配置 AI 大模型或 DeepL；每次请求在后台处理一种语言，保存部分进度，后续访问或后台轮询继续；失败可重试。在线翻译会发送文章内容给配置的服务。
- D1 单行上限为 2 MiB，本实现将单条记录限制在 1.5 MB；超限文章/译文会明确报错。首次快照最多 898 篇文章；一次后续变更最多 900 条记录，批量导入应分批。目前每次 API 请求读取完整数据快照，D1 的读取、写入和单请求查询额度取决于 Cloudflare 套餐，较大站点需要进一步按表分页优化。
- Pages 后台不生成 Windows/Linux 本机归档；源码目录中的 `npm run package` 仍同时发布双平台便携包和校验清单。

## 本地预览与验证

```sh
npm ci
npm run db:migrate:local
npm run dev
```

首次设置可复制 `.dev.vars.example` 为 `.dev.vars`，填入自己的随机 SETUP_TOKEN。`.dev.vars` 已忽略，不会上传。

```sh
npm test
npm run build
npm run verify:build
npm run package
node scripts/verification/verify-release.mjs
```

`verify:build` 使用临时隔离 D1 和临时文件存储，不改正式 data/；浏览器验证使用 Windows 已安装的 Microsoft Edge。生产部署前应检查 Cloudflare 项目已绑定正确数据库、迁移成功、首次设置后管理页可登录。
