---
description: 每次代码改动后更新 CHANGELOG.md
---

# 更新 CHANGELOG 工作流

每次完成代码改动（新功能、bug 修复、优化、重构等）后，必须执行以下步骤：

// turbo-all

1. 打开 `CHANGELOG.md`（位于 TheGhostFace 项目根目录）
2. 在 `## [Unreleased]` 标题下，选择合适的分类添加一行描述：
   - `### Added` — 新功能
   - `### Fixed` — bug 修复
   - `### Changed` — 行为变更、优化、重构
   - `### Removed` — 删除的功能
3. 格式：`- [emoji] 简短描述（中文即可）`
   - 常用 emoji：💬聊天 📸朋友圈 📓日记 🌳树树 🛍️商店 📅日历 📞电话 🎵音乐 🔮塔罗 ⚙️设置 🎨UI 🐛Bug 🔧核心 🔒安全
4. 如果是多个模块的批量改动，每个模块记一行

## Release 时

当华华决定发布新版本时：

1. 把 `[Unreleased]` 下的内容移到新版本标题下
2. 格式：`## [x.y.z] — YYYY-MM-DD`
3. 清空 `[Unreleased]` 区域（保留标题）
4. 更新 `manifest.json` 的 `version` 字段
5. 更新 `README.md` 的版本信息（如需要）
