# 当前交付包

每个正式版本同时交付 Windows x64 ZIP 和 Linux x64 TAR.GZ。在项目根目录依次执行 `npm test`、`npm run build`、`npm run verify:build`、`npm run package`，生成 `downloads/<版本>/` 下的两个带版本号归档和 `release.json`（含 SHA-256）。历史版本目录会保留。根目录的 `yanyang-government-windows-x64.zip`、`yanyang-government-linux-x64.tar.gz` 是当前下载别名。

Windows 10/11 x64：完整解压 ZIP 后双击“启动网站.cmd”。Linux x86_64、glibc 2.28+：使用 `tar -xzf 包文件名 -C 目标目录` 解压，进入目录运行 `bash start.sh --no-browser`；停止用 `bash stop.sh`。详细操作见 [使用说明](../docs/usage.md)。

后台“部署与备份”也可分别下载两个系统的当前内容迁移包。包内不包含当前管理员账号、审批、反馈和操作日志，首次进入管理模式需在新电脑本机设置超级管理员；远程 Linux 可使用说明中的 SSH 隧道。包内包含文章、草稿和网站区域文字，请只交给接管网站的人员。生成文件不进入源码版本库，只保留此说明文件。
