# 目录说明

源码、运行数据、生成产物和历史验证材料分别存放。开发时在项目根目录执行 npm 命令，完整操作见 [使用说明](usage.md)。

```text
wz/
├─ app/                     Next App Router 路由和元数据入口
├─ functions/               同域 Pages Functions API 入口
├─ migrations/              D1 数据库迁移
├─ public/                  前端页面、脚本、样式和图片
│  └─ assets/               图片、图标及图片授权记录
├─ server.mjs               Node.js 服务入口
├─ lib/                     账号、文章、审批、反馈、日志和存储逻辑
├─ data/                    私有运行数据及其备份
├─ deployment/              Windows / Linux 启停脚本、打包逻辑和部署说明
├─ scripts/                 构建、打包和可重复使用的验证脚本
├─ tests/                   自动化测试
├─ docs/                    使用说明、目录约定及设计和实施记录
├─ dist/                    可重新生成的完整服务目录
├─ out/                     Next 静态导出及公开初始内容快照
├─ wrangler.toml            Pages 构建输出和 D1 绑定配置
├─ downloads/               当前双平台包别名和按版本保存的成对部署包
├─ artifacts/
│  ├─ screenshots/          界面验证截图
│  ├─ logs/                 测试和验证过程日志
│  ├─ reports/              验证报告及上下文记录
│  └─ archive/              历史布局、部署副本及一次性验证材料
├─ .runtime/                打包所需的 Node.js 运行环境缓存
├─ package.json             版本信息和 npm 命令
├─ .editorconfig            编码、缩进及换行约定
├─ .gitignore               私有数据、生成产物及临时文件忽略规则
└─ README.md                项目说明和快速启动
```

## 源码与运行数据

`public/` 是前端源码目录；浏览器访问路径仍由服务提供，例如 `/app.js`、`/assets/` 和 `/admin`。服务与部署脚本使用项目根目录中的 `lib/`、`deployment/` 和 `data/`。

Next 的页面交互组件在 public/next/，app/ 读取 public/ 页面模板。共享 API 在 lib/http-handler.mjs，Pages 使用 lib/pages-handler.mjs 和 lib/d1-store.mjs，便携服务使用 server.mjs 和文件存储。Cloudflare 线上私有数据保存在 D1；本地 Pages 模拟状态在 .wrangler/，本地密钥在已忽略的 .dev.vars。完整部署说明见 [Pages 部署](cloudflare-pages.md)。

`data/` 保存管理员账号、文章、网站区域文字、审批、反馈、操作日志和运行记录，按实际使用逐步创建文件。`data/backups/` 中的历史备份同样属于私有数据。不要将该目录移入 `public/`、提交到版本库或作为公开附件分享。完整备份前先停止网站，再复制整个 `data/`；内容备份和部署迁移包的范围见 [使用说明](usage.md)。

## 生成产物

`npm run build` 会重建 `dist/`，其中包含可直接运行的服务、前端文件、文章和网站区域内容快照。它可以重新生成，不应作为源码修改入口。`dist/data/` 若已用于运行网站，会产生该实例自己的私有数据；重新构建前应先停止并备份该实例。

构建首先生成 out/，再把同一套 Next 页面与静态资源放入 dist/public/ 和双平台包；不要手工编辑 out/、dist/ 或历史归档。out/portal-seed.json 仅含公开文章及网站区域内容，首次 API 请求写入 D1 后不再覆盖线上内容；私有数据和草稿不会进入 out/。

`npm run package` 每次把 Windows ZIP、Linux TAR.GZ 和 `release.json` 校验清单写入 `downloads/<版本>/`，并更新根目录的两个当前包别名。每版必须两个平台齐全，版本目录保留历史交付记录。部署包带有自己的运行环境和启动脚本，完整解压后使用。该包包含文章草稿，应仅交给接管网站的人员。早期单平台交付物仍保存在历史归档中。

`.runtime/` 是经过校验的运行环境缓存，由打包命令准备；删除后再次打包可能需要联网下载。源码服务的启动不需要此目录，后台导出部署包仍需可用的打包运行环境。

## 验证材料与历史归档

`artifacts/screenshots/`、`artifacts/logs/`、`artifacts/reports/` 保存验证证据，说明见 [验证材料目录](../artifacts/README.md)。`artifacts/archive/deployment-tests/` 保留历史解压部署副本；`artifacts/archive/previous-layout/` 保留目录整理前的前端快照；`artifacts/archive/legacy-validation/` 以 `.txt` 保存历史一次性脚本。旧构建目录和旧交付包分别保存在 `artifacts/archive/builds/` 与 `artifacts/archive/downloads-before-2.3.1/`。

归档移动清单见 [归档清单](../artifacts/reports/workspace-archive-manifest.json)。历史部署副本可能包含账号、反馈、日志和独立运行数据，应按私有备份保管。报告中的旧路径、端口或 PID 仅描述当时环境，不能用来判断当前服务状态。可重复运行的验证逻辑放在 `scripts/`，自动化测试放在 `tests/`。

`.gitignore` 排除 `data/`、`dist/`、`downloads/`、`artifacts/` 和 `.runtime/` 的内容，同时允许各目录自身的 `README.md` 说明文件。编辑器默认使用 UTF-8、LF 和两个空格缩进；`.cmd` 使用 CRLF，`.ps1` 使用带 BOM 的 UTF-8 和 CRLF。
