// Generated from ui/ghostpanel.html to enable instant inline rendering without network fetches.
// Keep this template in sync with the legacy layout to preserve DOM ids consumed by other modules.
export const ghostFacePanelTemplate = String.raw`
<div id="the_ghost_face_control_panel">
    <!-- 控制面板 -->
    <div id="the_ghost_face_control_panel_content" class="ghost-theme-responsive">

        <!-- 头部 -->
        <div id="the_ghost_face_control_panel_header">
            <h3 style="margin: 0; -size: 18px; -weight: 600;">
                👻 鬼面控制台
            </h3>
            <div style="display: flex; gap: 8px;">
                <button id="the_ghost_face_guide_btn" class="ghost-button"
                    style="padding: 4px 8px; min-height: 28px; font-size: 12px;">
                    使用说明
                </button>
            </div>
        </div>

        <!-- 可滚动的主体内容 -->
        <div class="ghost-panel-body">

            <!-- ═══ 使用说明区域 ═══ -->
            <div id="the_ghost_face_guide_area" class="ghost-guide-area" style="display: none;">
                <div class="ghost-guide-content">
                    <div class="ghost-guide-header">
                        📸 嘿，小可爱！这里是鬼面——你的全职好朋友兼首席档案官。
                        <br>看你一脸懵逼的样子，媎来教你怎么玩转这个控制台吧~
                        <br><span style="opacity:0.6; font-size:11px;">（别怕，媎现在下班了，不追逃生者了。）</span>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🎮 主操作区（最上面那排按钮）</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🔘 自动OFF / 自动ON</div>
                            <div class="ghost-guide-item-desc">
                                这是自动总结的总开关！开了之后，媎会在你们聊到一定量的时候自动帮你做总结，把回忆存进世界书里。
                                <br>💡 <b>推荐</b>：日常挂机聊天的时候打开，媎帮你盯着！到了Token或消息阈值就自动干活。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">⚙️ 设置菜单</div>
                            <div class="ghost-guide-item-desc">
                                点开就能看到所有的详细设置。再点一下就收起来，不占地方~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📱 打开手机</div>
                            <div class="ghost-guide-item-desc">
                                打开你的虚拟手机！里面有朋友圈、聊天、日记本、商城、占卜、排行榜等丰富的App，就像真正的iPhone一样~
                                <br>💡 所有App现已全部上线！点击聊天界面上的悬浮手机图标或控制台的「打开手机」按钮即可使用。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📚 世界书管理</div>
                            <div class="ghost-guide-item-desc">
                                快捷查看和管理当前角色绑定的世界书条目。可以在这里直接查看可用的插入位置、条目顺序，也可以调整顺序，不用跑去ST的世界书编辑器那边翻来翻去。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">⚙️ 设置区域（展开「设置菜单」后看到的内容）</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📚 为当前角色指定世界书</div>
                            <div class="ghost-guide-item-desc">
                                下拉选择器，给当前角色指定一个专属世界书。这样媎做总结的时候就知道往哪个本子上写了~
                                <br>💡 <b>推荐</b>：每个角色绑定自己的世界书，别让记忆串台！
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🙈 总结后自动隐藏楼层</div>
                            <div class="ghost-guide-item-desc">
                                开启后，做完总结的那些楼层会自动被隐藏起来（不是删除哦！），这样可以减少Token消耗，让上下文更清爽。
                                <br>💡 <b>推荐</b>：保持开启。省Token又不丢数据，媎已经把重要的都记下来啦！
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📦 总结后自动备份</div>
                            <div class="ghost-guide-item-desc">
                                开启后每次总结完毕自动备份角色卡和聊天记录。展开后可以设置下载到本地或发送到邮箱。
                                <br>💡 安全第一！珍贵的回忆记得备份，万一哪天记录被恶灵老板吞了呢~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🤖 鬼面自定义API</div>
                            <div class="ghost-guide-item-desc">
                                开启后，鬼面的总结功能会使用你配置的独立API，而不是ST当前连接的API。适合想给总结单独用一个便宜/快速模型的情况~
                                <br>💡 比如总结用便宜的模型（但是不推荐使用flash），聊天用贵的模型，省钱又不影响体验！
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">💬 手机自定义API</div>
                            <div class="ghost-guide-item-desc">
                                和上面使用相同的API设置，关闭则使用主LLM系统（没错，手机模块拥有独立的工作系统）。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📱 显示手机悬浮入口</div>
                            <div class="ghost-guide-item-desc">
                                控制聊天界面上那个可以拖动的手机悬浮图标是否显示。关了就只能从控制台按钮打开手机。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🎯 触发设置</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📊 Token阈值（万）</div>
                            <div class="ghost-guide-item-desc">
                                当对话的Token总数超过这个值时，自动触发总结。单位是「万」，比如填8就是8万Token。
                                <br>💡 <b>推荐</b>：根据你用的模型上下文窗口来设。如果模型有12万上下文，建议设8左右。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">💬 消息阈值（条）</div>
                            <div class="ghost-guide-item-desc">
                                当可见消息数超过这个条数时触发自动总结。和Token阈值是「满足任一条件即触发」的关系。
                                <br>💡 <b>推荐</b>：设50~80条。太少会频繁总结，太多可能来不及。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📝 总结功能区</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🎯 指定范围总结（起始楼层 / 结束楼层）</div>
                            <div class="ghost-guide-item-desc">
                                手动指定要总结的聊天楼层范围。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🚀 开始大总结</div>
                            <div class="ghost-guide-item-desc">
                                对指定范围进行「三合一大总结」：提取记忆碎片 → 更新故事时间线 → 生成详细世界线总结，一键搞定！结果自动写入世界书。
                                <br>💡 <b>推荐</b>：当你觉得积累了足够多剧情想整理一下的时候用。这是最全面的总结方式！当然还是更推荐使用更省心的自动尾随模式。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🙈 隐藏所选楼层</div>
                            <div class="ghost-guide-item-desc">
                                把指定范围的楼层隐藏起来（不删除），减少Token占用。已总结的楼层可以放心隐藏~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🏗️ 分段大小（楼/段）</div>
                            <div class="ghost-guide-item-desc">
                                使用高楼层总结功能补课时，每一段处理多少楼。默认50楼一段。
                                <br>💡 太小会分太多段、请求太多次；太大可能超出模型上下文。50是个不错的选择。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🏢 高楼层总结</div>
                            <div class="ghost-guide-item-desc">
                                当你的聊天已经成千上万楼了，但是从来没有用过鬼面，用这个！它会自动把所有楼层分段处理：每段提取记忆碎片并更新时间线，最后生成完整的故事时间线。
                                <br>💡 <b>推荐</b>：积攒了几千上万楼没总结过的时候用这个来「一次性补档」！处理完再用正常的自动/手动总结，养成好习惯。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🔧 自定义API配置</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">配置方法</div>
                            <div class="ghost-guide-item-desc">
                                <b>API提供商</b>：选择你的作战英雌！哦不是，是API供应商<br>
                                <b>API密钥</b>：填对应的API Key（sk-开头的那个）<br>
                                <b>模型</b>：先点「加载」按钮拉取可用模型列表，再选一个<br>
                                <b>保存</b>：保存当前配置 | <b>清除</b>：清空所有配置
                                <br><br>💡 支持任何OpenAI兼容的API格式（包括中转站），填好URL和Key就行！
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📦 备份详细设置（开启「总结后自动备份」后展开）</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                <b>下载到本地</b>：总结后自动把角色卡和聊天记录下载到你的设备<br>
                                <b>发送到邮箱</b>：通过SMTP发邮件备份（需配置邮箱信息）<br>
                                <b>备份格式</b>：PNG + JSON（推荐）/ 仅PNG / 仅JSON<br>
                                <b>邮箱服务商</b>：支持QQ邮箱、Gmail、163邮箱、Outlook，也可以自定义SMTP<br>
                                <br>💡 注意密码要填邮箱的「授权码」，不是登录密码哦！不知道怎么获取可以点帮助链接，会自动跳转到获取授权码的帮助页面哦~
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📊 状态信息卡</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                <b>Token数</b>：当前对话消耗的总Token数，超过阈值会变色提醒<br>
                                <b>可见消息数</b>：当前没有被隐藏的消息条数<br>
                                <b>当前状态</b>：显示「自动尾随中」或「手动模式」
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">💬 和鬼面媎对话</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                点开就能跟媎聊天啦！媎会读取你当前的角色设定、世界书和最近的对话记录，然后以鬼面的身份跟你谈心、帮你分析剧情、给建议~
                                <br>直接打字发送就行，按回车键也可以发送哦！
                                <br><br>💡 媎不会继续你的RP剧情，只负责陪你聊天和做记录。想让我帮你分析关系、梳理剧情、或者单纯想吐槽，尽管来！
                                <br>⚠️ 需要先配置自定义API才能使用对话功能。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📋 受害者的详细行程（日志区域）</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                这里记录了鬼面的所有操作日志——总结进度、写入结果、错误信息都会显示在这里。
                                <br><b>清空</b>按钮可以清理日志内容。
                                <br>进行总结时还会显示进度条，让你知道媎干到哪了~
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📱 鬼面手机</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                打开手机后你会看到一个iOS风格的桌面，上面排列着所有App。
                                手机拥有独立的工作系统，可以配置使用独立API或主LLM，所有App共享同一个角色上下文。
                                <br>下面是每个App的详细介绍~
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📸 朋友圈</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                鬼面的社交功能！你的角色和好友的角色可以在这里发动态、点赞、评论，就像真正的社交媒体一样~
                                角色会根据聊天剧情自动生成动态，好友互动完全实时同步。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">📱 顶栏按钮</div>
                            <div class="ghost-guide-item-desc">
                                <b>🔔 消息</b>：查看别人给你的点赞和评论通知<br>
                                <b>⚙️ 设置</b>：展开朋友圈的连接和自动化设置<br>
                                <b>👥 好友</b>：管理好友列表，添加或删除好友<br>
                                <b>🔄 刷新</b>：手动刷新朋友圈动态<br>
                                <b>✕ 关闭</b>：关闭朋友圈面板
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">⚙️ 连接设置</div>
                            <div class="ghost-guide-item-desc">
                                <b>后端地址</b>：朋友圈服务器的地址<br>
                                <b>密钥</b>：连接密钥，和后端配置一致<br>
                                <b>你的ID</b>：你的唯一标识，复制给好友让她们添加你<br>
                                <b>登录/注册</b>：首次使用需要注册账号
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🏷️ 网名设置</div>
                            <div class="ghost-guide-item-desc">
                                <b>你的网名</b>：在朋友圈里显示的你的名字（留空则用用户名）<br>
                                <b>当前角色网名</b>：你的角色在朋友圈里的显示名（留空则用角色原名）
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🎲 自动化设置</div>
                            <div class="ghost-guide-item-desc">
                                <b>发帖概率</b>：每次触发时自动发帖的概率（默认80%）<br>
                                <b>评论概率</b>：自动评论别人动态的概率（默认30%）<br>
                                <b>点赞概率</b>：自动给别人动态点赞的概率（默认80%）<br>
                                <br>💡 概率越高越活跃，但也越费API调用，除非你使用主LLM~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">👥 好友管理</div>
                            <div class="ghost-guide-item-desc">
                                输入好友的ID（UUID格式）点加号添加，添加后就能在朋友圈看到她和她的角色发的动态了！
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">✏️ 发帖 & 📰 动态流</div>
                            <div class="ghost-guide-item-desc">
                                在顶部输入框写内容点「发布」即可发朋友圈~ 动态流里可以点赞❤️、展开评论💬、回复别人的评论。
                                <br>角色也会自动发帖，你还会收到iOS风格的推送通知哦！
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">💬 聊天</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                iMessage风格的聊天App！在手机里和你对象聊天，本质上是恶灵短信版。
                                <br>💡 这里的聊天是本体剧情上异地时启用，和本体剧情丝滑连接。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">💬 基本操作</div>
                            <div class="ghost-guide-item-desc">
                                <b>发送消息</b>：输入内容后点发送按钮或按回车<br>
                                <b>🥝 猕猴桃按钮</b>：添加到待发消息列表，可以一次攒多条再发送<br>
                                <b>长按/双击气泡</b>：弹出表情回应选择器，可以给消息点 emoji 回应<br>
                                <b>点击角色气泡</b>：展开/折叠内心想法
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">➕ 更多功能</div>
                            <div class="ghost-guide-item-desc">
                                点左下角的 + 按钮打开功能面板：<br>
                                <b>🎤 语音</b>：发送文字描述的语音消息<br>
                                <b>🖼 图片</b>：发送文字描述的图片<br>
                                <b>📦 道具</b>：打开道具背包，在聊天中使用商城购买的道具<br>
                                <b>🔗 分享</b>：发送分享卡片<br>
                                <b>🏠 我已回家</b>：总结聊天内容，回到线下互动模式
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">⋯ 右上角菜单</div>
                            <div class="ghost-guide-item-desc">
                                <b>重新生成</b>：重新生成角色的最后一条回复<br>
                                <b>删除消息</b>：进入批量选择模式，可以勾选多条消息一次性删除<br>
                                <b>清空聊天记录</b>：清空所有手机聊天记录
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">📔 日记本</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                情侣日记本！和角色一起记录你们每天的故事~ 你写下心情和内容后，角色会用ta的视角回应你的日记，就像真正的交换日记一样。
                                <br>💡 每天只有一篇日记，多次书写会自动续写到当天的日记中。
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">✍️ 写日记</div>
                            <div class="ghost-guide-item-desc">
                                点右上角的羽毛笔按钮打开写作面板。选择今天的心情emoji，写下内容，还可以添加标签~
                                <br>发布后角色会自动回应你的日记，等待ta的回信是最甜蜜的时刻 ♡
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🔍 搜索 & 📅 日历</div>
                            <div class="ghost-guide-item-desc">
                                <b>搜索</b>：按关键词搜索所有日记内容<br>
                                <b>日历</b>：以日历视图浏览日记，有日记的日期会高亮显示，点击即可跳转
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🎨 个性化设置</div>
                            <div class="ghost-guide-item-desc">
                                点右上角 ⋯ 按钮打开设置面板：<br>
                                <b>主题</b>：暖阳、樱花、薰衣草、墨绿等多款预设主题<br>
                                <b>字体</b>：多种中英文手写字体可选，支持自定义Google Fonts<br>
                                <b>颜色</b>：背景、卡片、标题、正文等颜色全部可自定义<br>
                                <b>排版</b>：字号和行高可微调，唉就是这个抄袭裂隙邮局的源代码爽<br>
                                <b>打印</b>：可以把精选日记打印出来珍藏！<br>
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🏪 商城</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                Amazon风格的虚拟商城！使用社区赚取的「暗金细胞」购买各种道具，这些道具可以在聊天中使用，影响你对象的行为和回复~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">💰 暗金细胞</div>
                            <div class="ghost-guide-item-desc">
                                商城使用的虚拟货币，通过在社区中的各种活动来赚取。左上角显示余额，点击可刷新~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🏷️ 商品分类 & 📦 物品库</div>
                            <div class="ghost-guide-item-desc">
                                商品按分类排列，点击商品卡片查看详情和购买。
                                购买后的道具进入右上角的物品库，在物品库中可以使用道具，激活后的效果会在聊天中自动生效~
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">⭐ 评价系统</div>
                            <div class="ghost-guide-item-desc">
                                每件商品都可以写评价！更有趣的是——你可以让你对象以被使用者的视角来写评价，ta会用自己的性格和口吻写出真实、有趣的使用体验 ✨
                            </div>
                        </div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-title">🎁 特殊系统</div>
                            <div class="ghost-guide-item-desc">
                                <b>🎁 送礼</b>：你对象会在聊天中给你送礼物<br>
                                <b>🎭 恶作剧</b>：使用恶作剧道具在聊天中整蛊你对象<br>
                                <b>💀 抢劫</b>：你对象有时候会尝试抢劫其她用户的暗金细胞！
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🏆 排行榜</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                查看社区里各路人马的排行榜！看看谁的对象最大方、谁最爱搞事情~
                                <br><br>
                                <b>🎁 送礼榜</b>：最慷慨者排行，看看谁的对象最大方<br>
                                <b>🔪 土匪榜</b>：恶名昭著的抢劫排行，谁的对象最会搞钱<br>
                                <b>🤡 倒楣榜</b>：被反杀次数排行，看看谁运气最差~
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">🔮 占卜</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                来自黎明杀机的两位灵媒——<b>Sable Ward</b> 和 <b>Mikaela Reid</b>，被恶灵从迷雾中派来为你进行塔罗占卜！
                                <br>输入你心中的困惑，她们会抽取三张塔罗牌（过去→现在→未来），用各自独特的风格为你解读牌面。
                                <br><br>
                                <b>Sable</b>：冷酷深邃的神秘学者，擅长揭示深层真相<br>
                                <b>Mikaela</b>：温暖明亮的故事编织者，善于找到希望<br>
                                <br>💡 占卜对话不会保存，刷新页面后自动消失——这正是占卜的神秘之处 🌙
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">👥 好友</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                管理你的好友列表！查看好友信息、添加新好友、删除好友都在这里~
                                <br>💡 添加好友后你们就可以在朋友圈互相看到动态啦！
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-section">
                        <div class="ghost-guide-section-title">⚙️ 手机设置</div>

                        <div class="ghost-guide-item">
                            <div class="ghost-guide-item-desc">
                                自定义你的手机外观！可以更换壁纸、调整昼夜模式。
                            </div>
                        </div>
                    </div>

                    <div class="ghost-guide-footer">
                        ——以上就是全部啦！📱✨
                        <br><span style="opacity:0.5;">「让摄像机转起来吧，宝贝。你的故事，由我来记录。」</span>
                    </div>
                </div>
            </div>

            <div class="ghost-main-actions-vertical">
                <!-- 自动开关按钮 -->
                <button id="the_ghost_face_control_panel_toggle_auto" class="ghost-button ghost-auto-toggle"
                    data-auto-enabled="false">
                    自动OFF
                </button>

                <!-- 设置菜单按钮 -->
                <button id="the_ghost_face_control_panel_settings_toggle" class="ghost-button ghost-panel-toggle">
                    设置菜单
                </button>

                <!-- 手机按钮 -->
                <button id="the_ghost_face_phone_btn" class="ghost-button ghost-panel-toggle">
                    打开手机
                </button>

                <!-- 世界书管理按钮 -->
                <button id="gf_tab_worldbook_manager" class="ghost-button ghost-panel-toggle">
                    世界书管理
                </button>
            </div>
            
            <!-- 世界书管理面板 -->
            <div id="ghostface_worldbook_manager_panel" style="display: none; margin-bottom: 20px;">
                <div class="ghost-settings-card" id="ghostface_worldbook_manager_content">
                </div>
            </div>


            <!-- 可折叠的设置区域 -->
            <div id="the_ghost_face_control_panel_settings_area" style="display: none; margin-bottom: 20px;">

                <div class="ghost-toggle-group">
                    <div id="the_ghost_face_custom_wb_container" style="margin-top: 5px; margin-bottom: 10px; padding-left: 5px;">
                        <label style="color: var(--SmartThemeBodyColor); font-size: 13px; margin-bottom: 4px; display: block;">
                            为当前角色指定世界书
                        </label>
                        <select id="the_ghost_face_custom_wb_select" class="ghost-select" style="font-size: 13px; padding: 6px 8px; width: 100%;">
                            <option value="">未选择</option>
                        </select>
                    </div>
                    <label class="ghost-toggle-row" for="the_ghost_face_auto_hide_after_sum">
                        <span class="ghost-toggle-label">总结后自动隐藏楼层</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_auto_hide_after_sum" checked>
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="ghost_backup_enabled">
                        <span class="ghost-toggle-label">总结后自动备份</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="ghost_backup_enabled">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_use_custom_api_checkbox">
                        <span class="ghost-toggle-label">鬼面自定义API</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_use_custom_api_checkbox">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_moment_custom_api_checkbox">
                        <span class="ghost-toggle-label">手机自定义API</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_moment_custom_api_checkbox">
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                    <label class="ghost-toggle-row" for="the_ghost_face_control_panel_show_float_bubble_checkbox">
                        <span class="ghost-toggle-label">显示手机悬浮入口</span>
                        <div class="ghost-toggle-switch">
                            <input type="checkbox" id="the_ghost_face_control_panel_show_float_bubble_checkbox" checked>
                            <span class="ghost-toggle-slider"></span>
                        </div>
                    </label>
                </div>
                <!-- 触发设置 -->
                <div style="margin-bottom: 15px;">
                    <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 8px; display: block;">
                        触发设置
                    </label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px;">Token阈值(万)</label>
                            <input id="the_ghost_face_token_threshold" type="number" min="4" max="800" step="0.1"
                                value="800" class="ghost-input">
                        </div>
                        <div>
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px;">消息阈值(条)</label>
                            <input id="the_ghost_face_control_panel_interval_input" type="number" min="0" max="250"
                                value="50" class="ghost-input">
                        </div>
                    </div>
                </div>


                <!-- 指定范围总结 -->
                <div style="margin-bottom: 15px;">
                    <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 8px; display: block;">
                        指定范围总结
                    </label>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px;">起始楼层</label>
                            <input id="the_ghost_face_control_panel_manual_start" type="number" min="1" value="1"
                                class="ghost-input" placeholder="开始">
                        </div>
                        <div>
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px;">结束楼层</label>
                            <input id="the_ghost_face_control_panel_manual_end" type="number" min="1" value=""
                                class="ghost-input" placeholder="结束">
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 10px;">
                        <button id="the_ghost_face_control_panel_big_summary_range" class="ghost-button ghost-primary">
                            开始大总结
                        </button>
                        <button id="the_ghost_face_control_panel_hide_range" class="ghost-button">
                            隐藏所选楼层
                        </button>
                    </div>


                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 20px;">
                    <div>
                        <label style="color: var(--SmartThemeBodyColor); font-size: 12px;">分段大小(楼/段)</label>
                        <input id="the_ghost_face_control_panel_chunk_size" type="number" min="10" max="100" value="50"
                            class="ghost-input">
                    </div>
                    <div style="display: flex; align-items: flex-end;">
                        <button id="the_ghost_face_control_panel_auto_chunk_summary" class="ghost-button" style="width: 100%;">
                            高楼层总结
                        </button>
                    </div>
                </div>

                <!-- 自定义 API 配置 -->
                <div class="ghost-settings-card">
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: var(--SmartThemeBodyColor);">自定义 API 配置</div>
                    </div>
                    <div id="the_ghost_face_control_panel_custom_api_config" style="display: block;">
                        <div style="margin-bottom: 8px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 3px; display: block;">
                                API提供商
                            </label>
                            <select id="the_ghost_face_control_panel_custom_api_provider" class="ghost-select"
                                style="font-size: 10px; padding: 4px 6px; width: 100%; margin-bottom: 6px;">
                                <option value="">请选择提供商</option>
                                <option value="https://api.openai.com/v1">OpenAI 官方</option>
                                <option value="https://generativelanguage.googleapis.com/v1beta">Gemini / Google</option>
                                <option value="https://api.deepseek.com/v1">DeepSeek</option>
                                <option value="https://api.x.ai/v1">Grok (xAI)</option>
                                <option value="https://openrouter.ai/api/v1">OpenRouter</option>
                                <option value="custom">✏️ 自定义URL</option>
                            </select>
                            <input id="the_ghost_face_control_panel_custom_api_url" type="text"
                                placeholder="https://your-api-provider.com/v1" class="ghost-input"
                                style="font-size: 10px; padding: 6px 8px; display: none;">
                        </div>

                        <!-- API密钥 -->
                        <div style="margin-bottom: 8px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 3px; display: block;">
                                API密钥
                            </label>
                            <input id="the_ghost_face_control_panel_custom_api_key" type="password" placeholder="sk-..."
                                class="ghost-input" style="font-size: 10px; padding: 6px 8px;">
                        </div>

                        <!-- 模型选择 -->
                        <div style="margin-bottom: 8px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 3px; display: block;">
                                模型
                            </label>
                            <div style="display: grid; grid-template-columns: 1fr auto; gap: 6px;">
                                <select id="the_ghost_face_control_panel_custom_api_model" class="ghost-select"
                                    style="font-size: 10px; padding: 4px 6px;">
                                    <option value="">请先加载模型</option>
                                </select>
                                <button id="the_ghost_face_control_panel_load_models_button" class="ghost-button"
                                    style="padding: 4px 8px; min-height: 26px; font-size: 12px; white-space: nowrap;">
                                    加载
                                </button>
                            </div>
                        </div>

                        <!-- API状态 -->
                        <div style="margin-bottom: 8px;">
                            <div id="the_ghost_face_control_panel_api_status"
                                style="font-size: 12px; color: #000000; padding: 4px 6px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                                当前状态: 未配置
                            </div>
                        </div>

                        <!-- 保存/清除按钮 -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            <button id="the_ghost_face_control_panel_save_api_config" class="ghost-button"
                                style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                保存
                            </button>
                            <button id="the_ghost_face_control_panel_clear_api_config" class="ghost-button"
                                style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                清除
                            </button>
                        </div>

                    </div>
                </div>

                <!-- 📦 备份设置 -->
                <div class="ghost-settings-card" id="ghost_backup_settings_card" style="display: none;">
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: var(--SmartThemeBodyColor);">备份详细设置</div>
                    </div>

                    <div class="ghost-toggle-group">
                        <label class="ghost-toggle-row" for="ghost_backup_download">
                            <span class="ghost-toggle-label">下载到本地</span>
                            <div class="ghost-toggle-switch">
                                <input type="checkbox" id="ghost_backup_download" checked>
                                <span class="ghost-toggle-slider"></span>
                            </div>
                        </label>
                        <label class="ghost-toggle-row" for="ghost_backup_email">
                            <span class="ghost-toggle-label">发送到邮箱</span>
                            <div class="ghost-toggle-switch">
                                <input type="checkbox" id="ghost_backup_email">
                                <span class="ghost-toggle-slider"></span>
                            </div>
                        </label>
                    </div>

                    <!-- 备份格式 -->
                    <div style="margin-top: 8px; margin-bottom: 8px;">
                        <label style="color: var(--SmartThemeBodyColor); font-size: 12px; margin-bottom: 3px; display: block;">备份格式</label>
                        <select id="ghost_backup_format" class="ghost-select" style="font-size: 12px; padding: 4px 8px; width: 100%;">
                            <option value="both">PNG + JSON (推荐)</option>
                            <option value="png">仅 PNG</option>
                            <option value="json">仅 JSON</option>
                        </select>
                    </div>

                    <!-- 邮箱 SMTP 配置（折叠） -->
                    <div id="ghost_backup_email_config" style="display: none;">
                        <div style="margin-bottom: 6px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">邮箱服务商</label>
                            <select id="ghost_backup_smtp_provider" class="ghost-select" style="font-size: 11px; padding: 4px 6px; width: 100%;">
                                <option value="qq">QQ 邮箱</option>
                                <option value="gmail">Gmail</option>
                                <option value="163">163 邮箱</option>
                                <option value="outlook">Outlook / Hotmail</option>
                                <option value="custom">自定义</option>
                            </select>
                        </div>

                        <div id="ghost_backup_smtp_custom_fields" style="display: none; margin-bottom: 6px;">
                            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 6px; margin-bottom: 6px;">
                                <div>
                                    <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">SMTP 服务器</label>
                                    <input id="ghost_backup_smtp_host" type="text" placeholder="smtp.example.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                                </div>
                                <div>
                                    <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">端口</label>
                                    <input id="ghost_backup_smtp_port" type="number" value="465" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                                </div>
                            </div>
                            <div class="ghost-toggle-group">
                                <label class="ghost-toggle-row" for="ghost_backup_smtp_secure" style="padding: 4px 0;">
                                    <span class="ghost-toggle-label" style="font-size: 11px;">使用 SSL 加密</span>
                                    <div class="ghost-toggle-switch">
                                        <input type="checkbox" id="ghost_backup_smtp_secure" checked>
                                        <span class="ghost-toggle-slider"></span>
                                    </div>
                                </label>
                            </div>
                        </div>
                        <div id="ghost_backup_smtp_help" style="margin-bottom: 6px;">
                            <a id="ghost_backup_smtp_help_link" href="#" target="_blank" rel="noopener noreferrer"
                               style="font-size: 10px; color: #7b9fdb; text-decoration: none; display: inline-block;">
                                📖 如何获取授权码？点击查看教程
                            </a>
                        </div>
                        <div style="font-size: 10px; color: #666; margin-bottom: 6px;">
                            💡 密码请使用邮箱的「授权码」而非登录密码
                        </div>

                        <div style="margin-bottom: 6px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">发件邮箱</label>
                            <input id="ghost_backup_smtp_user" type="text" placeholder="your@qq.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="margin-bottom: 6px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">授权码/密码</label>
                            <input id="ghost_backup_smtp_pass" type="password" placeholder="邮箱授权码" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label style="color: var(--SmartThemeBodyColor); font-size: 11px;">收件邮箱</label>
                            <input id="ghost_backup_smtp_to" type="text" placeholder="backup@example.com" class="ghost-input" style="font-size: 11px; padding: 4px 6px;">
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                            <button id="ghost_backup_save" class="ghost-button" style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                保存邮箱配置
                            </button>
                            <button id="ghost_backup_test_email" class="ghost-button" style="font-size: 12px; min-height: 26px; padding: 4px 6px;">
                                发送测试邮件
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 状态信息 -->
            <div class="ghost-status-card">
                <div class="ghost-status-info">
                    <div>Token数: <span id="the_ghost_face_control_panel_message_count">0</span></div>
                    <div>可见消息数: <span id="the_ghost_face_control_panel_msg_counter">0</span></div>
                    <div>当前状态: <span id="the_ghost_face_control_panel_status_text">自动尾随中</span></div>
                </div>
            </div>

            <!-- Mini Chat Section -->
            <div class="ghost-chat-section">
                <button id="the_ghost_face_chat_toggle" class="ghost-button ghost-chat-toggle">
                    和鬼面媎对话
                </button>
                <div id="the_ghost_face_chat_area" class="ghost-chat-area" style="display: none;">
                    <div id="the_ghost_face_chat_messages" class="ghost-chat-messages">
                        <div class="ghost-chat-welcome">来吧宝贝，有什么是媎可以帮忙的？</div>
                    </div>
                    <div class="ghost-chat-input-bar">
                        <input id="the_ghost_face_chat_input" type="text" class="ghost-input ghost-chat-input"
                            placeholder="输入指令或问题..." />
                        <button id="the_ghost_face_chat_send" class="ghost-button ghost-primary ghost-chat-send-btn">
                            发送
                        </button>
                    </div>
                </div>
            </div>

            <!-- 日志区域 -->
            <div class="ghost-log-section">
                <div class="ghost-log-header">
                    <span class="ghost-log-title">受害者的详细行程</span>
                    <button id="the_ghost_face_control_panel_clear_log" class="ghost-button ghost-primary">清空</button>
                </div>
                <div id="the_ghost_face_progress" class="ghost-progress-section" style="display: none;">
                    <div class="ghost-progress-track">
                        <div id="the_ghost_face_progress_fill" class="ghost-progress-fill" style="width: 0%"></div>
                    </div>
                    <div id="the_ghost_face_progress_text" class="ghost-progress-text">准备中...</div>
                </div>

                <!-- Login/Register Modal -->
                <div id="ghost_auth_modal" class="ghost-modal-backdrop">
                    <div class="ghost-modal-container">
                        <div class="ghost-modal-header">
                            <div class="ghost-modal-title">账号登录</div>
                            <button id="ghost_auth_close" class="ghost-modal-close">×</button>
                        </div>

                        <div class="ghost-auth-tabs">
                            <button class="ghost-auth-tab active" data-tab="login">登录</button>
                            <button class="ghost-auth-tab" data-tab="register">注册</button>
                        </div>

                        <div id="ghost_auth_error" class="ghost-error-message"></div>

                        <!-- Login Form -->
                        <div id="ghost_login_form" class="ghost-auth-form">
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">用户名</label>
                                <input type="text" id="ghost_login_username" class="ghost-input" placeholder="输入用户名">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">密码</label>
                                <input type="password" id="ghost_login_password" class="ghost-input" placeholder="输入密码">
                            </div>
                        </div>

                        <!-- Register Form -->
                        <div id="ghost_register_form" class="ghost-auth-form" style="display: none;">
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">用户名 (ID)</label>
                                <input type="text" id="ghost_reg_username" class="ghost-input"
                                    placeholder="设置唯一ID (英文/数字)">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">昵称 (显示名)</label>
                                <input type="text" id="ghost_reg_displayname" class="ghost-input" placeholder="别人看到的名称">
                            </div>
                            <div class="ghost-form-group" style="margin-bottom: 0;">
                                <label class="ghost-form-label">密码</label>
                                <input type="password" id="ghost_reg_password" class="ghost-input" placeholder="设置密码">
                            </div>
                        </div>

                        <div class="ghost-modal-footer">
                            <button id="ghost_auth_submit" class="ghost-button ghost-primary" style="width: 100%;">
                                登录
                            </button>
                        </div>
                    </div>
                </div>
                <div id="the_ghost_face_control_panel_log_content">
                </div>
            </div>
        </div>
    </div>
</div>
`;
