# Changelog

All notable changes to TheGhostFace will be documented in this file.


---

## [Unreleased]

---

## [4.1.6] — 2026-03-19

### Added
- 🎲 D&D App：完整的地下城冒险 TRPG 系统（12个模块文件）
  - 角色创建（种族/职业/属性值/技能选择）
  - 搭档 AI 角色自动生成
  - 战役系统（多种预设战役，房间探索）
  - 回合制战斗（先攻/攻击/法术/职业能力/死亡豁免）
  - 探索系统（陷阱房间/NPC遭遇/宝藏/休息点）
  - D20 骰子系统（能力检定/攻击骰/伤害骰）
  - 法术系统（法术位/准备法术/施法）
  - 物品 & 商店系统（冒险前购买装备/消耗品）
  - 背包管理、装备穿戴
  - 自由行动输入（玩家可输入任意行为）
  - 冒险日志 & 历史记录
  - 房间转换叙事压缩（LLM 总结）
  - 服务器端 DnD 数据存储（`dnd_data` 表 + REST API）
- 💬 聊天：手动总结按钮（主动触发 summarize）
- 💬 聊天：char 拥有时间感知
- 💬 聊天：LLM 回复持久化（未回复的消息不再丢失）
- ⚙️ `phoneSettings.js`：全局手机设置模块

### Changed
- 🌳 树树默契挑战 & 真心话：注入随机脑洞种子池，60% 天马行空题目 + 40% 角色相关，告别千篇一律
- 🔧 总结器重写：新增 `splitMessagesByTokens` 分片逻辑，优化大对话总结
- 💬 聊天 Prompt Builder：提示词改为英文版本（提高 LLM 效果）
- 📞 语音通话：环境音效管理器 `ambientManager.js` 改进
- 🔧 `api.js`：LLM 调用逻辑优化（+76行改动）
- 🔧 `timeline.js`：时间线系统重构
- 🔧 `worldbook.js`：世界书注入改进
- 🔧 `utils.js`：工具函数扩展
- 🔧 `index.js`：新增 phoneSettings 初始化

### Fixed
- 🎨 修复主屏备忘录 Widget 深色模式下文字/图标不可见的问题
- 💬 修复聊天 App LLM 最后一条消息刷新后丢失的 bug
- 🖥️ 修复 Console App 的 Fetch Patch 阻塞 ST 流式输出（开启 Console 后文字不再逐字出现而是一次性蹦出）

### Optimized
- 🖥️ Console App：移除 Token 计数功能，解决性能卡顿问题（网络 Tab 的 API usage 信息保留）


## [4.1.5] — 2026-03-18

### Added
- 📞 语音通话：GPT-SoVITS 情感参数、环境音效、主动拨打、来电铃声
- 📞 语音通话：拒接通知 & 快速挂断
- 📞 语音通话：独立 prompt 系统 + MiniMax 自定义 voice ID
- 🎵 音乐 App：歌单管理、歌曲生成
- ⚙️ 设置 UI 改进

### Fixed
- 🐛 聊天、日记、朋友圈、塔罗、语音通话模块的多个小 bug
- 🔒 HTTPS + Cloudflare CORS Proxy 支持

---

## [4.1.4] — 2026-03-15

### Added
- 📞 TTS Provider 语音选择器 UI
- 🔒 手机 Apps 登录 + Discord 绑定锁定

### Fixed
- 📸 朋友圈身份混淆问题
- 🌳 树树 / 语音 / 总结器多项修复
- 💬 typo fix in addLocalComment

---

## [4.1.2] — 2026-03-10

### Added
- 📞 语音通话系统
- 💬 聊天语音 & 图片消息
- 🌗 深色模式修复（控制台 App header 等）

---

## [4.1.1] — 2026-03-06

### Added
- 📅 日历 App
- 📓 日记升级
- 🌳 树树云端优先同步
- 💬 聊天设置合并
- 📸 朋友圈健康检查

### Changed
- 🔧 核心代码重构

---

## [4.1.0] — 2026-03-01

### Added
- 🌳 树树 App
- 🧠 智能片段合并

### Changed
- ✨ UI 整体打磨

---

## [4.0.2] — 2026-02-20

### Changed
- 📝 聊天总结升级为 Ghost Face 结构化报告

### Fixed
- ➕ plus-btn & double-context bug

---

## [4.0.0] — 2026-02-15

### Added
- 📱 手机模拟器系统初版
- 💬 聊天 App
- 📸 朋友圈 App
- 🛍️ 商店 App (礼物/抢劫/恶作剧)
- 📓 日记 App
- 🔮 塔罗 App
- ⚙️ 设置 App
- 👥 好友 App
