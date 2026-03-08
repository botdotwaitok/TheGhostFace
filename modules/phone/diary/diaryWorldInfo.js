
// modules/phone/diary/diaryWorldInfo.js — 世界书注入 + 主 LLM 输出解析
// 非自定义 API 模式下，通过世界书条目注入日记指令，
// 并从角色的聊天输出中解析 (日记: xxx) 格式的内容。

import { useMomentCustomApi } from '../../api.js';
import { getContext } from '../../../../../../extensions.js';

const DIARY_LOG_PREFIX = '[日记本]';

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function _getCharacterInfo() {
    try {
        const context = getContext();
        const charId = context.characterId;
        const charData = (context.characters ?? [])[charId];
        if (!charData) return null;
        return {
            name: charData.name || context.name2 || 'Character',
        };
    } catch {
        return null;
    }
}

function _getUserName() {
    try {
        const context = getContext();
        return context.name1 || 'User';
    } catch {
        return 'User';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// World Book Injection — 把日记上下文写入世界书条目
// ═══════════════════════════════════════════════════════════════════════

/**
 * 将最近的日记内容注入世界书条目 <gf_diary>，
 * 让主 LLM 在回复用户时可以选择写日记段落。
 * @param {object[]} recentEntries - 最近的日记条目列表
 */
export async function updateDiaryWorldInfo(recentEntries = []) {
    try {
        const { saveWorldInfo, loadWorldInfo } = await import('../../../../../../world-info.js');
        const { findActiveWorldBook } = await import('../../utils.js');

        const worldBookName = await findActiveWorldBook();
        if (!worldBookName) return;

        const WI_KEY = 'm_diary';
        const wb = await loadWorldInfo(worldBookName);
        let targetEntry = Object.values(wb.entries).find(e => e.key && e.key.includes(WI_KEY));

        // 如果没有日记条目或日记列表为空，disable 该条目
        if (recentEntries.length === 0) {
            if (targetEntry && !targetEntry.disable) {
                targetEntry.disable = true;
                await saveWorldInfo(worldBookName, wb);
            }
            return;
        }

        const charInfo = _getCharacterInfo();
        const userName = _getUserName();
        const charName = charInfo?.name || '角色';

        // 格式化最近日记为文本
        const diaryText = recentEntries.slice(0, 2).map(entry => {
            const segs = entry.segments.map(s => `  ${s.name}: ${s.content.substring(0, 200)}`).join('\n');
            const hasBothSegments = entry.segments.some(s => s.author === 'char');
            const statusTag = hasBothSegments ? '[双方都已写]' : '[等待你的回应]';
            return `[${entry.date}] ${entry.mood} ${entry.moodText} ${statusTag}\n${segs}`;
        }).join('\n---\n');

        // 仅在有"等待回应"的日记时，才加入指令
        const pendingEntries = recentEntries.filter(e => !e.segments.some(s => s.author === 'char'));
        const hasPending = pendingEntries.length > 0;

        let instructionBlock = '';
        if (hasPending) {
            instructionBlock = `
⚠️ ${userName}最近写了日记但${charName}还没有回应。在你完成正常的回复内容之后，请在回复最末尾添加你的日记回应。
格式: (日记: 你要写的日记内容)
- 以${charName}的第一人称视角来写
- 回应${userName}的日记内容，可以补充你的视角、感受、吐槽或撒娇
- 1-3段即可（100-300字），像写手帐日记一样自然
- 绝对禁止：任何侮辱性词语或脏话`;
        }

        const entryContent = `
<gf_diary>
【情侣日记系统】
{{char}}和{{user}}有一本共同的情侣日记，她们会在同一天的日记页上各自写下自己的内容。
以下是最近的日记记录:
<recent_diary_entries>
${diaryText}
</recent_diary_entries>
${instructionBlock}
</gf_diary>
`;

        if (!targetEntry) {
            let maxId = 0;
            Object.keys(wb.entries).forEach(id => {
                const num = parseInt(id);
                if (!isNaN(num) && num > maxId) maxId = num;
            });
            const newId = maxId + 1;

            wb.entries[newId] = {
                uid: newId,
                key: [WI_KEY, '日记本'],
                comment: '情侣日记实时数据 (Auto-generated)',
                content: entryContent,
                constant: true,
                position: 4,
                depth: 1,
                order: 997,
                disable: false,
                excludeRecursion: true,
                preventRecursion: true,
                displayIndex: 0
            };
        } else {
            targetEntry.content = entryContent;
            targetEntry.disable = false;
            targetEntry.position = 4;
            targetEntry.depth = 1;
            targetEntry.order = 998;
            targetEntry.excludeRecursion = true;
            targetEntry.preventRecursion = true;
        }

        await saveWorldInfo(worldBookName, wb);
    } catch (e) {
        console.warn(`${DIARY_LOG_PREFIX} updateDiaryWorldInfo failed:`, e);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// System Prompt Injection — 给主 LLM 的日记协议指令
// ═══════════════════════════════════════════════════════════════════════

/**
 * 返回注入到主 LLM 的指令协议文本。
 * 仅在非自定义 API 模式下才会附加"必须使用格式"的强制语句。
 */
export function getDiarySystemPrompt() {
    const basePrompt = `[DIARY PROTOCOL]
Couple's diary entries are in World Info. To write a diary entry, use:
- Write diary: (日记: your diary text)
- ONLY use this format AT THE END of your regular reply.`;

    if (!useMomentCustomApi) {
        return basePrompt + `\n\n【IMPORTANT】如果日记中有标记"[等待你的回应]"的条目，你必须在正常回复之后用 (日记: ...) 格式写你的日记段落。`;
    }
    return basePrompt;
}

// ═══════════════════════════════════════════════════════════════════════
// Chat Output Parser — 从主 LLM 输出中解析日记内容
// ═══════════════════════════════════════════════════════════════════════

/**
 * 解析角色回复中的 (日记: xxx) 格式标签，提取角色的日记段落。
 * @param {string} content - 角色的回复内容
 * @returns {{diaryContent: string}|null} - 解析出的日记内容，无则返回 null
 */
export function parseDiaryFromChatOutput(content) {
    if (!content) return null;

    const diaryMatches = Array.from(content.matchAll(/\((?:日记|Diary):\s*(.+?)\)/gi));
    if (diaryMatches.length > 0) {
        // 取最后一个匹配（最新的）
        const lastMatch = diaryMatches[diaryMatches.length - 1];
        if (lastMatch && lastMatch[1]) {
            const text = lastMatch[1].trim();
            if (text) {
                console.log(`${DIARY_LOG_PREFIX} 从主 LLM 输出中解析到日记内容: ${text.substring(0, 50)}...`);
                return { diaryContent: text };
            }
        }
    }
    return null;
}
