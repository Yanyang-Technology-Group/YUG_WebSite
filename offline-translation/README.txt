离线文章翻译资源

worker: deployment/offline-translate.py
Windows runtime: runtime/translation/windows-x64/python.exe
Linux runtime: runtime/translation/linux-x64/bin/python3
worker --root 指向离线包中的 offline-translation 目录。进程使用 JSON Lines：每条请求
包含 id、article（title、summary、source、body）和 languages；每个语言返回 translation，
最后返回 done。模型和 Python 依赖已随部署包提供，运行期间不会访问网络。

模型：M2M100 418M CTranslate2 int8（MIT），来源版本与文件 SHA-256 记录在 manifest.json。
