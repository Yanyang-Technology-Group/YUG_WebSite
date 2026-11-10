# 政府门户实现计划

**目标：** 在空工作区交付参考中国政府网的本地中文政府门户。

**架构：** 原生 HTML/CSS/ES Modules，内容与交互分离，无运行依赖。Node 提供本地服务和静态打包。

**技术栈：** HTML、CSS、JavaScript、Node.js 24。

**规格：** ../specs/2026-10-10-government-portal-design.md

## 文件职责

- index.html / styles.css：页面结构、图标、视觉与响应式布局。
- portal-data.js / assets/：本地资讯、服务指南与城市图。
- portal-utils.js / app.js：关键词匹配、轮播、栏目、详情、服务、留言和无障碍交互。
- server.mjs / scripts/build.mjs：本地开发与产物打包。
- tests/search.test.js：查询匹配、空输入、栏目限制与不改变原数据。

## 实施与核验

- [x] 编写搜索失败测试并运行，确认缺失行为。
- [x] 实现 searchContent(items, query, category)，重跑测试。
- [x] 创建首页、样式、数据和交互模块，所有链接仅用站内 hash。
- [x] 构建并启动本地服务，核验新闻详情、搜索、标签、轮播、服务和留言。
- [x] 检查桌面/手机布局、资源加载、控制台错误及所有链接。

## 审查重点

空搜索提示；特殊字符显示；留言只本地保存且不用真实个人信息；弹层恢复焦点；窄屏无横向溢出；图片没有国徽国旗；零外部跳转。
