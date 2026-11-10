# 验证材料

本目录保留开发和交付过程的验证证据。当前源码与部署操作见 [项目说明](../README.md) 和 [使用说明](../docs/usage.md)。

| 目录 | 用途 |
| --- | --- |
| `screenshots/` | 桌面、移动端与管理界面的验证截图 |
| `logs/` | 自动化测试、临时服务和部署验证日志 |
| `reports/` | 验证报告、结果 JSON 及当时的环境上下文 |
| `archive/deployment-tests/` | 历史解压部署副本及其独立数据 |
| `archive/previous-layout/` | 目录整理前的前端源码快照 |
| `archive/legacy-validation/` | 以 `.txt` 保存的历史一次性验证脚本和旧代码片段 |
| `archive/builds/` | 目录整理前的构建产物 |
| `archive/downloads-before-2.3.1/` | 目录整理前的 ZIP 和解压材料 |

移动记录见 [归档清单](reports/workspace-archive-manifest.json)。归档材料用于追溯，不作为当前启动或验证入口。可重复运行的验证脚本位于 `scripts/`，自动化测试位于 `tests/`。报告中记录的旧目录、PID 和端口只表示当时状态。

历史部署副本含有自己的 `data/`，可能保存账号、反馈和日志，按私有备份保管。截图和报告分享前也需检查其中的信息。本目录产物不进入源码版本库，只保留此说明文件。
