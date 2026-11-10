晏阳联合政府网站 · Linux x64 便携部署说明

适用系统：Linux x86_64，glibc 2.28 及以上（例如 Debian 10+、Ubuntu 20.04+）。
不适用 Alpine/musl、ARM64 或 Windows。系统需提供 sh、tar、sha256sum 和 nohup。
部署包内置官方 Node.js v24.21.0，无需安装系统 Node、npm 或任何第三方依赖。
联网优先翻译：登录高级或超级管理员后打开后台“翻译设置”，可视化选择 AI 大模型（兼容 Chat Completions）、DeepL 或仅离线模型，填写 HTTPS 接口、模型名和密钥后保存并测试连接。AI 大模型可接入 DeepSeek、通义千问等兼容服务；DeepL 也可在启动前执行 `export DEEPL_API_KEY='你的密钥'`（可选 `export DEEPL_API_URL='https://兼容服务/v2/translate'`）作为默认配置。密钥只保存在服务器 `data/translation-settings.json`，页面只显示掩码，不进入文章、日志、备份或部署包。连接测试只发送固定短示例；联网失败时可回退包内离线模型，选择仅离线模型时不会发送文章内容。
请使用普通用户运行，不需要 root；脚本不会安装系统软件或修改防火墙。
管理后台可分别导出 Windows x64（ZIP）和 Linux x64（TAR.GZ）便携部署包。
导出支持离线使用，包含当前文章、网站内容和对应平台运行环境；不包含原管理员密码、
会话、待审批请求或用户反馈。迁移后的部署需要重新设置自己的超级管理员。

支持普通、高级、超级三种管理员等级。高级与超级管理员都可管理全站、审批、反馈、日志、备份和部署。
只有超级管理员在“管理员管理”可以调整其他账号等级（普通、高级、超级）。
高级管理员可添加普通或高级管理员并管理非超级管理员的密码与状态，不能修改现有账号等级或创建、修改、删除超级管理员。
不能调整自身等级，至少保留一名启用的超级管理员。调整等级后目标账号须重新登录。

1. 将整个 TAR.GZ 完整解压到可读写的目录，保留 public、lib、deployment、runtime、data。
   例如（将路径替换为你下载的部署包和目标目录）：
   mkdir -p "$HOME/yanyang-government"
   tar -xzf yanyang-government-linux-x64.tar.gz -C "$HOME/yanyang-government"
   cd "$HOME/yanyang-government"
   目录名可以包含中文和空格。以下命令均在解压目录中执行。

2. 启动本机访问：
   sh start.sh
   服务器或无桌面环境：sh start.sh --no-browser
   网站：http://127.0.0.1:5173
   后台：http://127.0.0.1:5173/admin.html
   默认仅监听 127.0.0.1。桌面环境有 xdg-open 时会尝试打开浏览器。
   服务通过 nohup 在后台运行，关闭终端后仍继续运行。

3. 首次设置超级管理员：
   必须从服务器本机的 127.0.0.1 访问后台，先设置自己的管理员密码。
   远程服务器可在自己的电脑建立 SSH 本地转发：
   ssh -N -L 15173:127.0.0.1:5173 用户名@服务器地址
   然后在自己电脑浏览器访问 http://127.0.0.1:15173/admin.html 完成首次设置。
   若服务器改用其他端口，将转发命令中的第二个 5173 改为实际端口。
   直接用局域网或公网地址不能完成首次超级管理员设置。

4. 局域网访问：
   sh start-lan.sh --no-browser
   或：sh start.sh --lan --no-browser
   此模式监听 0.0.0.0；同一网络的其他电脑使用 http://服务器局域网IPv4:5173。
   如需网络放行，请自行按照所在网络要求配置；脚本不会修改防火墙。
   建议先通过本机或 SSH 转发完成首次管理员设置，再启用局域网模式。

5. 改用其他端口（1024 至 65535）：
   sh start.sh --port 5174 --no-browser
   PORT=5174 sh start.sh --no-browser
   --port 会覆盖 PORT 环境变量。启动方式或端口改变前先停止当前服务。
   重复启动同一方式和端口时会检查现有进程及服务健康，不会启动第二份。
   其他程序或另一份部署占用端口时会报告失败，可换用空闲端口。

6. 停止：
   sh stop.sh
   只会停止当前解压目录内、进程身份和启动时间均匹配的内置 Node 服务。
   PID 被复用、运行记录损坏或进程身份不符时会拒绝操作。
   停止不会删除文章、账号、日志或其他 data 文件。
   deployment 目录中的同名脚本也可使用，例如 sh deployment/start.sh。

运行环境与故障排查：
- 每次启停都会用 SHA-256 校验 runtime/node-v24.21.0-linux-x64.tar.gz；
  首次启动会解压到 runtime/linux/node-v24.21.0-linux-x64/。
  每次使用前还会比对解压后的 bin/node 与已校验归档中的 Node。
  校验失败时请重新获取和完整解压可信部署包，不要绕过校验或换用系统 Node。
- 如提示执行权限不足，可恢复内置 Node 执行权限：
  chmod u+x runtime/linux/node-v24.21.0-linux-x64/bin/node
  可直接使用 sh start.sh，无需给启动脚本添加执行权限。
- 标准输出：data/server.log；错误日志：data/server-error.log。
  运行记录：data/server.pid。请勿手工修改正在运行服务的 PID 记录。
  启停锁：data/.launcher.lock；异常中断留下的有效旧锁会自动回收。
  若锁内容不完整，请先确认无其他启停命令正在执行，再移除该锁文件。
- noexec 文件系统、glibc 太旧、磁盘满或目录无写入权限都可能导致启动失败。
  更换为兼容且允许执行、普通用户可写的目录后重试。
- 迁移和备份应先停止服务，再复制整个部署目录，妥善保存 data 中的账号及内容。
  请勿只复制 public 目录或单个网页文件。
