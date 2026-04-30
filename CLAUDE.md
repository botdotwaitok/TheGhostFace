# TheGhostFace SillyTavern 插件工作区

## 开场必读

- `.agents/rules/` — 项目规则
- `.agents/project_architecture.md` — 架构全景
- `.agents/workflows/` — 固定流程入口

开始工作前请先检索上述目录中是否有与当前任务相关的规则/流程文档。

## 硬红线：UI 改动验证方式

**不要尝试自己打开浏览器验证 UI 改动**，原因：

- SillyTavern 酒馆页面**不在** `localhost:3000`（那是 GF_ServerDashboard）
- 酒馆的实际环境由华华手动运行，AI 这边无法访问

正确做法：

1. 完成代码改动后，写清楚**让华华执行的验证步骤**
2. 示例格式："打开手机 → Console App → 检查是否有 5 个 Tab"
3. 等华华手动测试后反馈结果，再据此继续迭代

## 前端规范

- 图标统一使用 **Phosphor Icons**，不使用 Unicode Emoji
- 不使用左侧装饰性竖条（border-left bar），改用边框高亮 / 背景色等表达状态
