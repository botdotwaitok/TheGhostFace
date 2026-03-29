# Changelog

All notable changes to TheGhostFace will be documented in this file.


---

## [4.2.0] — 2026-03-29

### Added
- 📓 **手账本支持修改 LLM 生成贴纸** — 现在 LLM 回应便笺中的内置贴纸也支持内联编辑了！点击便笺内的贴纸，会在上方弹出一个精巧的贴纸库浮窗，你可以自由将当前贴纸一键替换为了你图库中的任意贴纸，修改过程同样自动静默云端保存。
- 📓 **手账本导出图片功能** — 工具栏新增“下载为图片”按钮，点击后通过动态加载 `html2canvas` 截屏技术，剔除显示缩放干扰，将当前页面无论底纹、自定义背景、贴纸、画笔内容及富文本便笺一并高清捕获，直接将完整的画面生成为本地图片。
- 📓 **手账本自定义背景画廊** — 自定义背景从单张覆盖改为可无限上传的历史画廊模式；启动时自动预加载所有历史保存的背景图，在“设置”页签中以缩略图网格展示，点击缩略图即可直接切换当前页背景；新增带🗑️垃圾桶按钮的逻辑删除功能，方便清理不再使用的冗余背景
- 📓 **手账本新增胶带库系统** — 工具栏新增“胶带”工具，右侧面板新增“胶带”库可以上传和管理自定义胶带图案，支持读取预设。采用“直线拉伸铺贴引擎”，用户通过拖拽画出直线，系统使用 DOMMatrix 与 CanvasPattern 将胶带图块沿着笔画角度旋转和缩放填充，胶带粗细随工具栏滑块动态改变。
- 📓 **手账本回应便笺图层** — LLM 回应从页面底部固定区域变为可拖拽、缩放、旋转的便笺贴纸，放置在 sticker layer 上与贴纸共享交互（pointer 拖动 / 双指缩放 / 滚轮缩放 / 旋转手柄 / 删除按钮 / 自由调整长宽），❤ 按钮支持重新生成，绘画工具激活时事件穿透便笺到画布，扉页寄语同步迁移，位置数据跨页持久化
- 📓 **手账本页面独立底纹** — 每页的底色、纹理类型、纹理样式独立存储，修改底纹只影响当前页，新建页面继承全局默认值；Settings Tab 标题显示"当前页面样式 — 第 N 页"
- 📓 **手账本 LLM 富文本回应** — LLM 回应从单一便签卡 + 纯文本改为透明背景 + 多段落富文本（blocks 系统）：LLM 排版工具箱支持字体（手写/中文手写/花体/正文）、颜色（6色预设 + 自定义 hex）、大小（5档）、对齐/粗体/斜体；点击文字段落弹出浮动编辑工具栏；LLM 可引用用户贴纸库插入贴纸；旧数据自动迁移兼容
- 📓 **手账本记忆上次访问位置** — 关闭手账本后再打开，会自动跳转到上一次停留的页面（扉页 / 某一页日记 / 封面），不再每次固定回到封面

### Fixed
- 🐛 修复手账本页面四周始终存在 padding 导致可书写面积缩小的 bug — `_initResponsiveScaling()` 中 `getElementById('hb_content')` ID 拼写错误（实际为 `hb_content_area`），导致 ResizeObserver 从未挂载、CSS `--hb-scale` 变量从未生效，纸张始终以固定 595×870px 原始尺寸渲染；同时移除缩放公式中的 64px 安全内边距，使纸张自适应填充满整个可用区域
- 🐛 修复手账本在使用虚线画笔时的两大失效 bug：① **粗画笔变实线**：虚线的线段与间隙不再写死为 [6, 4]，而是根据当前画笔粗细动态缩放。② **慢速画变实线**：修复了连续绘制时虚线相位（dash offset）不断重置的问题，现已通过累加绘制距离实现完美连续的虚线笔触。
- 🐛 修复手账本在新页面上传背景图后，全局底纹样式被锁定导致无法再次切换其他图案（圆点/网格等）的 bug — 修复了当操作未保存的新页面时，错误地覆盖了全局 `pattern` 参数而非 `pagePattern` 导致设置面板状态错乱的问题；同时修复了旧版机制导致新页面不断“继承”上一页自定义背景的过度粘滞现象
- 🐛 **修复手账本在 PC 端上传的自定义贴纸、背景和胶带在 iPad / iOS 端被全部拒绝加载并处于罢工状态的严重 Bug** — 这是由于 Safari / WebKit 极其严苛的 MIME 类型校验引起的：原版上传机制会直接把用户图库中选中的 JPG/PNG 等格式通过重命名 `.webp` 后缀名直接保存上云，这在宽容度高的 PC Chrome 下毫无异常，但当 iPad 试图拿 `image/webp` 协议去解码一个内含真身是 PNG 的文件时会因“魔术头不匹配”强行阻断；**修复此问题：** 引入 `convertToWebP` 底层拦截器，所有上传前图像必须在离屏 Canvas 经过强制定向直出一次标准 WebP 压缩包再上传服务器以保证所有端数据格式永远对齐。
- 🐛 修复手账本使用胶带工具后 auto-save 报错 `Diary auto-save failed` 及自定义胶带不渲染的双重 bug — ① Safari/WebKit 把 SVG data: URI 通过 `createPattern` 画到 canvas 后视为跨域，导致 `toDataURL()` 抛 SecurityError（canvas tainted）；修复：新增 `_safeImageUrl` 将 data: URI 转为同源的 blob: URL ② 上一轮修复误加的 `crossOrigin='anonymous'` 反而破坏了 blob: URL 的加载（blob 没有 CORS 服务器），导致自定义上传胶带完全不渲染；已移除 ③ `exportAsDataUrl` 加容错 try-catch，auto-save 检测空导出时跳过上传
- 🐛 修复手账本点击爱心按钮生成回应时报错 `_diaryAutoSaveLock is not defined` 的问题 — 补充了遗漏的模块变量 setter 导出
- 🐛 修复手账本因重构遗漏导致 `_switchToView` 和 `_escapeHtml` 函数未导出引起的模块崩溃（Boot failed / 点击目录导航报错）
- 🐛 修复手账本加载暂无 AI 回应的页面时，控制台疯狂报错 404 的问题 — 将获取不到的空结果缓存为 `null`，避免重复无效请求
- 🐛 修复手账本日记目录侧边栏无法重新编辑 AI 生成标题的 bug — 增加了行内编辑（点击铅笔图标修改标题并即时保存）
- 🐛 修复手账本调节 LLM 响应区块尺寸时受 CSS 最大宽度限制的 bug — 手动调整时自动解锁 `max-width` 限制
- 🐛 修复手账本页面贴纸缺少等比缩放手柄的 bug — 贴纸选中时附带左下角缩放调节按钮，适配非触屏设备的尺寸调节
- 🐛 修复手账本封面视图下无法打开设置菜单的 bug — 添加与目录对应的左侧浮动菜单按钮（`hb-menu-fab`），确保从封面直接编辑样式
- 🐛 修复手账本封面会铺满全屏的问题 — 封面现在的尺寸完全对齐内页（A4比例），表现为一本真实的笔记本封面
- 🐛 修复手账本封面设置不实时预览的 bug — 在封面设置区（标题/副标题/颜色/文字样式/上传图片）修改内容时会触发封面的实时重新渲染，实现所见即所得
- 🐛 修复手账本在使用删除键清空画布后，刷新页面已删除的内容又会恢复的 bug — 画布为空时不直接 return，允许保存空白画布覆盖旧数据
- 🐛 修复手账本 LLM 回应便笺删除后刷新页面又会恢复的 bug — 删除时同步在服务器端清空 JSON 数据并解除 `meta.json` 里的位置引用
- 🐛 修复手账本在新版左侧弹出目录中丢失“删除页面”按钮的 bug — 在目录项 hover 时显示删除按钮，修复旧事件绑定失效问题
- 📓 手账本：修复扉页无法调整页面样式的问题 — `_getCurrentPageObj()` 在扉页视图返回 `_meta.flyleaf` 样式数据，Settings Tab 现在对扉页可用
- 📓 手账本：修复 LLM 富文本回应只能编辑一次样式的 bug — 旧 `closeHandler` 未随 `_dismissBlockEditor()` 一起清理，残留监听器会立即关闭新编辑器
- 📓 手账本：修复点击编辑器按钮无响应的 bug — response note 拖拽 `setPointerCapture` 抢占指针事件，现在点击文字段落时跳过拖拽
- 📓 手账本：修复引用贴纸不持久化的 bug — `_placeResponseNote` 渲染前预加载 blocks 中引用的贴纸图片到缓存
- 📓 手账本：修复 iPad Apple Pencil 无压感效果的 bug — `_getPressure()` 中 `e.pressure < 1` 条件将满压力值（1.0）排除在外，导致用力按压时反而回退到固定 0.5；改为通过 `e.pointerType === 'pen'` 精确识别触控笔并信任完整 0.05-1.0 压力区间
- 🐛 修复手账本点击爱心按钮发送 LLM 时报错「The string contains invalid characters」的 crash — 根因：预设胶带使用 SVG data URI，Safari/WebKit 对 SVG 图片有特殊跨域限制，即使转为同源 blob: URL 仍会通过 `createPattern()` 污染 canvas，导致 `toDataURL()` 抛出 SecurityError；修复：① 新增 `_safeImageUrlAsync` 将 SVG data URI 先光栅化为 PNG 位图再用于 canvas pattern（彻底绕过 Safari SVG 安全限制）② 爱心按钮路径增加空导出检测并给出中文提示 ③ `dataUrlToBlob` 增加输入合法性校验防止 `atob(undefined)` 崩溃
- 📞 语音通话：修复带省略号（`…`）等 Unicode 标点的句子不被 `<say>` 标签解析的 bug
- 📞 语音通话：修复多句回复只有前几句有声音的 bug — TTS 从「整段文字一次性发送」改为按句子逐句合成+播放（先按 `<say>` segment 拆分，再按句号/问号/感叹号二次拆分），每句使用独立 emotion，彻底解决 GPT-SoVITS 长文本静默截断问题
- 📞 语音通话：修复氛围背景音只在第一轮对话播放的 bug — `stopAmbient()` 从销毁 Audio 元素改为暂停+保留，下一轮 `startAmbient()` 可复用已解锁的元素，避免手机端 autoplay 策略拦截

### Changed
- 📓 **手账本自适应视图排版优化** — 采用原生 CSS 动态换算（`transform: scale + min()`）代替纯固定宽度，现在无论是在大屏显示器还是在狭长型设备上，A4 画布都会**自适应缩放（最高可放大2.5倍）尽最大可能铺满屏幕**，告别之前因为定宽而导致大尺寸屏幕四周产生大白边（padding）的尴尬情况；此技术重构巧妙地规避了 `canvas.width` 和内联样式的坐标偏移问题，确保绘画、贴纸和封面文字在任何缩放比例下**精确定位不断层**
- 📓 **手账本菜单交互优化** — 将“搜索”功能从工具菜单移至目录侧边栏顶部，统一页面导航体验；在“页面样式”设置中，将“上传自定义图片”单独分组并移至纹理样式列表下方，使菜单结构更符合用户直觉
- 📓 **手账本封面重构** — 移除固定的预设背景色和硬编码的标题/副标题输入框；改为允许使用原生取色器自由选择纯色背景；旧数据自动转为自由文字块（支持拖拽定位）；点击文字块支持直接在封面上进行“所见即所得”的内联富文本编辑（可改字体、字号、颜色、粗/斜体力、玻璃卡片背景）；为防止排版时误触，移除了点击封面跳转扉页的默认行为；并在点击背景空白处时自动保存并取消文本的编辑状态
- 📓 **手账本工具栏优化** — ① 顶部展示颜色的快捷球改为动态读取用户的「最近使用」颜色（初次使用或不足6色时使用默认预设），替换纯预设固定色 ② 笔刷选择器移除冗余的前置图标，纯文字居中展示更整洁 ③ 橡皮擦移至左侧绘画工具组（与画笔/形状/虚线/文字并列） ④ 调色板颜色点击即用（色板/取色器/最近使用色直接应用，移除「使用此颜色」按钮） ⑤ 新增「新建页面」按钮（ph-file-plus，紧跟 Apple Pencil 按钮） ⑥ 页脚简化为「PAGE 1 / PAGE 2」居中显示（移除日期和中文文字）
- 📓 **手账本目录重构：侧边栏 → 工具栏弹窗** — 移除占空间的常驻左侧侧栏，改为工具栏上的目录按钮（ph-list-bullets），点击弹出左侧滑入浮层式目录面板（backdrop 半透明遮罩 + slide-in 动画），封面视图显示浮动 FAB 按钮。新建页面后立即在目录中显示「新的一页（未保存）」条目，无需等待 LLM 回应
- 📓 **手账本菜单面板重构：底部上滑 → 右侧滑入手风琴** — 工具/设置菜单从底部半屏上滑改为右侧全高滑入面板（320px），水平 Tab 替换为纵向手风琴式 `<details>` 展开列表（搜索/贴纸/封面/页面样式/Console），每项配独立 Phosphor 图标 + 展开箭头，与左侧目录镜像对称（左导航、右工具）

- 📓 **手账本体检修复** — 全面代码审计+批量修复11项问题：nextPageId改为单调递增计数器防止页面ID碰撞、修复_switchToView中贴纸位置保存的自比较bug、auto-save与心形按钮竞态加锁、canvas undo/redo栈跨页隔离、菜单设置面板dirty刷新、Undo上限30降至20减内存、createEmptyMeta直出v4格式、standalone HTML Unicode emoji改Phosphor Icon、清理死代码约115行JS加160行CSS
- 📓 **手账本体检Phase2 — 命令式撤销重做** — 彻底重构 canvas undo/redo 系统：从存储全尺寸 ImageData 快照（8MB/帧 × 20帧 ≈ 160MB）改为基于命令的记录与回放（每笔画存点位数组 + 工具配置，典型会话内存 ~1-2MB）。支持 stroke/shape/tape/text/clear/base_image 六种命令类型，undo 通过清空画布+重放所有命令实现，redo 增量追加单条命令。同时修复：`_tocPanelOpen` ReferenceError 导致 Escape 键崩溃、Storage 路径替换正则错误、Engine 重复赋值、`_closePalette` 幽灵代码、`_updateEraserButton` 死函数、`AppState` 未声明的动态字段（tapeImageCache/activeTapeId）、`hasContent()` 全像素遍历改为 O(1) dirty flag、删除 4 个重构残留文件（toolbar_chunk.js/.txt, inspect.js/.json）
- 📓 **手账本体检Phase3 — 容错/性能/打磨** — 搜索预加载从逐个 await 改为 Promise.all 并行批量加载、贴纸图片 boot 预热（fire-and-forget）、文字换行修改为 CJK 逐字符 + 英文保词拆分的混合分词器、上传空 Blob 检查、dataUrlToBlob MIME 解析容错、删除 response note 后自动刷新 TOC 面板、搜索关键词正则转义防崩溃、自定义背景从覆盖全局改为仅影响当前页面、touchcancel 补充 passive: false
- 📓 **手账本 Warn/Error Toast 主动提醒** — `_setupConsoleCapture` 新增 `_showHandbookToast`：所有 `console.warn` / `console.error` 除仍写入 Console 面板外，还会在画面底部弹出带动画的悬浮通知卡（橙色=warn / 红色=error，含 Phosphor 图标 + 级别标签），warn 5 秒、error 7 秒后自动消失，也可点击立即关闭，同时限制最多 4 条并发，避免刷屏
- 📓 **手账本 LLM 贴纸字号调节优化** — 将原本使用的抽象字符串（小/正常/大/超大等）替换为更直观的精确数字像素值（12px–72px）；通过在底层的 `_resolveBlockSize` 添加自动回退与类型推断机制，平滑兼容所有历史创建的使用中文字号档位的旧贴纸，并在悬浮工具栏中统一下拉样式。

### Added
- 📓 **手账本 App (Phase 1)** — 全新独立窗口 Canvas 手写 App：压感手写 → 视觉 LLM 识别 → 角色手写字体回应 → ST 文件系统持久化。支持 BroadcastChannel 跨窗口通信、撤销/重做、橡皮擦、6色墨水、4种纸张纹理、深色模式
- 📓 **手账本 Phase 2** — 封面页（纯色渐变/自定义图片上传，首次进入全屏编辑器）、扉页（Owner: 横线 + Canvas 涂鸦 + 角色寄语）、底部悬浮菜单（目录/搜索/封面编辑/Console 四个Tab），爱心按钮触发 LLM 回应，视图状态机导航重构
- 📓 **手账本 Phase 3A：画笔系统 + 调色板** — 4种画笔（钢笔/马克笔/荧光笔/书法笔，各有独特渲染特性：压感、透明度、宽度倍率、笔尖形状），调色板浮层（原生取色器 + 莫兰迪/暖色/冷色预设色组 + 最近使用8色持久化），工具栏全面重构
- 📓 **手账本 Phase 3B：自定义背景 + 贴纸系统** — 底部菜单新增设置Tab（5种页面纹理即时切换：圆点/格子/横线/空白/自定义图片），自定义背景图上传，贴纸系统（上传PNG/WebP贴纸→托盘管理→拖放到日记页→pointer拖动/pinch缩放/旋转手柄/删除，贴纸层pointer-events穿透不干扰手写），per-page纹理覆盖，位置跨页持久化
- 📓 **手账本自定义页面样式系统** — 设置Tab重构为三分区：① 页面底色（6色预设 + 取色器）② 纹理类型（圆点/格子/横线/空白/自定义图片）③ 纹理样式（颜色6色预设 + 取色器、透明度/粗细/间距滑块），所有更改即时预览 + debounced 持久化
- 📓 **手账本 Phase 5：工具栏重构 + 新绘画工具** — ① 4种画笔（钢笔/马克笔/荧光笔/书法笔）合并为可展开的笔盒按钮 ② 形状工具（矩形/圆形/直线/箭头，拖拽绘制 + overlay实时预览） ③ 虚线模式 toggle（可叠加任何笔/形状） ④ 富文本输入工具（字体选择器含6种预设 + 自定义Google Fonts URL，字号/粗体/斜体，设置持久化到localStorage） ⑤ 统一工具模式管理系统
- 📓 **手账本画布自动保存** — 每次笔画/操作结束后 2 秒自动保存画布到 ST 文件系统（debounced），新页面自动创建 metadata；扉页同样支持自动保存

### Fixed
- 📓 **手账本顶部工具栏 iPad 适配** — 工具栏 flex-wrap 双行自适应布局，新增 `@media ≤1024px` 断点将颜色/粗细行折叠到第二行，按钮/颜色球/滑条逐级缩小，适配 iPad Mini/Air/Pro 全系列屏幕
- 📓 **手账本 Apple Pencil 专属绘画** — 自动检测 Apple Pencil（`pointerType === 'pen'`），开启后手指触摸不再触发画笔；工具栏新增 ✋ 手型按钮手动切换 pencil-only 模式
- 📓 手账本提交报 ST Proxy 400 — `_callSTProxy()` 缺少 `chat_completion_source` 和 `model` 字段导致 ST 后端无法路由请求；桥接层现在传递完整的 provider 信息
- 📓 手账本 LLM 回应 JSON 解析失败 — 模型返回推理文本包裹 JSON 时 `parseHandbookResponse` 直接 fallback 到原文；新增三层提取策略（直接解析 → 正则匹配 → 贪心大括号）
- 📓 手账本 Canvas 调试日志清理 — 注释掉 `handbookCanvas.js` 中 8 条 touch/pointer/resize 诊断性 console.log
- 📓 手账本页面跟随系统深色模式变全黑 — 移除 `prefers-color-scheme` 自动检测，强制 `color-scheme: light only`，手账本始终使用暖纸色浅色主题
- 📓 **手账本窗口 resize 后绘画内容消失** — `ResizeObserver` 触发 `canvas.width = ...` 清空画布（浏览器原生行为），改为固定 A4 尺寸（595×842px），canvas 不再 resize→内容永不丢失

### Changed
- 📓 **手账本 Phase 4 优化** — ① 扉页 Owner 标签居中显示 ② 菜单按钮 + 爱心按钮从底部中央移到右上角 ③ 贴纸功能从浮层移入菜单面板「贴纸」Tab ④ 贴纸自定义分类（创建/重命名/删除分类，上传自动归类） ⑤ 橡皮擦可调大小（弹出 popover 滑块，范围 2-50px）
- 📓 **手账本画布固定 A4 尺寸** — 画布从动态 flex 伸缩改为固定 595×842px（A4 比例 1:1.414），2× retina 渲染，小屏幕自动等比缩放
- 📓 **手账本菜单优化** — ① 点击上方半透明遮罩可关闭菜单 ② Tab 标签去掉 icon 只保留文字 ③「设置」Tab 改名为「页面」
- 📓 **手账本目录支持删除页面** — TOC 列表项 hover 显示垃圾桶图标，点击 confirm 后删除页面记录
- 📓 **手账本工具栏精简** — 移除顶部工具栏的翻页按钮（上一页/下一页/页码），改由目录菜单跳转
- 📓 **手账本画笔/橡皮擦尺寸加大** — 画笔粗细上限 10→30，橡皮擦上限 50→100



## [4.1.8&9] — 2026-03-23

### Changed
- 🔧 总结器/时间线：移除所有静默自动重试，改为出错即停 + `confirm()` 询问用户是否重试或跳过
### Fixed
- 📸 朋友圈身份混淆 bug — 用户评论后角色被误判为已互动，不再自动评论；WorldInfo 标签也误标 `[你已评论]`。根因：`getMyAuthorIds()` 混合了用户+角色 ID，改为仅匹配角色 `charAuthorId`（涉及 `generation.js` + `momentsWorldInfo.js`）
- 🐛 总结器多 chunk 超时 bug 修复 — `timeoutPromise` 从全局共享改为每个 chunk 独立计时，防止后续 chunk 立即超时；`callCustomOpenAI` fetch timeout 从 60s → 120s
- 🐛 大总结"我们的故事"多 chunk 合并失败时增加详细错误日志和 toastr 提示，方便诊断
- 🐛 时间线截断修复 — `appendToTimeline` 新增按 token 切割（~15k tokens/chunk），避免单次 prompt 过长导致模型输出截断（仅91 tokens）
---

## [4.1.7] — 2026-03-21

### Changed
- 🔧 总结器日志 emoji 清理 — 移除 `summarizer.js` 中所有 logger/toastr/confirm/注释里的装饰性 emoji（📊📦🔄❌🔒📝🙈🎉🚀等），仅保留 ✅ 成功对号；LLM prompt 模板中的 emoji 不受影响
- 🔮 **三合一总结重构为统一单次调用** — `handleManualRangeSummary` 改用 `generateUnifiedSummary`，大总结+记忆碎片+时间线合并为一次 LLM 调用（原来需要 2-6 次 API 调用），超长对话自动 fallback 到 chunking
- 🔧 总结器优化：记忆碎片+时间线合并为单次 LLM 调用（~11次 API → ~4-5次），TOKEN_CHUNK_SIZE 30k→50k
- 🔧 记忆碎片解析增强：`parseModelOutput` 正则更宽松（允许前导空白/多等号/markdown格式），新增全面诊断日志（原始输出、近似标记检测、裸标签检测）
- 🔧 记忆碎片解析修复：修复模型将 `[标题]` 写在 `===ENTRY===` 同行时内容被 regex group2 吞掉的 bug；块边界计算改用 `markerStart` 替代硬编码偏移
- 🔇 **总结器日志精简** — ~30 个 `logger.info` 降级为 `logger.debug`（chunk 细节、解析诊断、子步骤等），删除 10 个冗余 `toastr.info`/`toastr.success`（已有 progress bar 或按钮文字时不再重复弹窗），保留所有错误/警告/关键节点日志
### Added
- 🎲 D&D App：后日谈系统 — 胜利通关后搭档角色以日记形式写下200-400字冒险回忆
- 🎲 D&D App：多设备数据同步（与树树 App 同模式）
- 🎲 D&D App：大商店系统 — 商品从6件扩展到31件（药水/武器/防具/卷轴/补给/饰品），商店和背包均增加分类Tab按钮
- 🎲 D&D App：新角色起始15gp金币

### Changed
- 💬 聊天：打字性能优化 — `updateButtonStates()` 状态缓存避免每次按键重写 innerHTML、textarea resize 批量化、`escHtml()` 复用 DOM 元素、CSS 合成层优化

### Fixed
- 📞 语音通话：修复 STT 在 TTS 播放结束后不自动恢复的问题
- 📞 语音通话：修复 TTS 合成 400 错误（ref_audio 时长不足3秒）
- 📞 语音通话：修复手机端 GSVI TTS `fetchEmotion HTTP 400` — ST CORS Proxy 丢失 URL query params（`?character=xxx`），改为编码 `?`→`%3F` 保留参数
- 📞 语音通话：修复手机端 TTS 和氛围音无法播放 — 移动浏览器 AudioContext 自动播放策略限制，在用户点击拨号/接听时预热 AudioContext 和 HTMLAudioElement
- 🎲 D&D App：小屏幕 UI 响应式适配（`@media` queries）
- 🎲 D&D App：修复宝箱/战斗/探索中金币类战利品不入账的 bug（物品被当作字符串塞背包，现在自动转为 gold 字段）
- 🌳 树树：修复生成默契/真心话题目时界面卡死的问题 — LLM 调用增加 60s/90s 超时，生成页面新增"跳过"按钮，自动补充改为非阻塞提示条

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
