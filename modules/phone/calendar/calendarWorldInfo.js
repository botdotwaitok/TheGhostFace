// modules/phone/calendar/calendarWorldInfo.js — 日历 Prompt 注入 + 世界书注入
// 经期提醒 + 节日提醒 + 日期感知 → 直接拼入 system prompt，让角色感知现实世界
// 可选功能：将近期事件预告注入世界书条目，让角色主动提起未来的事件。

import { getPhoneUserName } from '../phoneContext.js';
import {
    loadPeriodData, isTodayInPeriod,
    getHolidaysForDate, getLocalDateString, PERIOD_SYMPTOMS,
    loadWISettings, getUpcomingEvents,
} from './calendarStorage.js';

/** 每日只注入一次经期/节日提醒，避免角色反复提及 */
let _lastInjectedDate = '';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 构建日历 prompt 块。
 * 包含：经期状态 + 当日节日 + 日期感知。
 * 经期和节日提醒每天只注入一次，之后只保留日期感知。
 * 由 chatPromptBuilder.buildChatSystemPrompt() 在组装 prompt 时调用。
 * @returns {string} 日历 prompt 块
 */
export function buildCalendarPrompt() {
    const today = getLocalDateString();
    const now = new Date();
    const dateLine = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日，星期${WEEKDAYS[now.getDay()]}。`;

    // 同一天只注入一次经期/节日提醒
    if (_lastInjectedDate === today) {
        return `\n<gf_calendar>\n${dateLine}\n</gf_calendar>`;
    }
    _lastInjectedDate = today;

    const blocks = [];

    // ── Period block ───────────────────────────────────────────
    const pd = loadPeriodData();
    if (pd.enabled && pd.promptInjection) {
        const status = isTodayInPeriod();
        if (status) {
            const userName = getPhoneUserName();
            const startDate = status.periodStart;
            const endDate = new Date(new Date(startDate + 'T00:00:00').getTime() + (pd.periodDays - 1) * 86400000);
            const endStr = getLocalDateString(endDate);

            let symptomText = '';
            if (pd.symptoms && pd.symptoms.length > 0) {
                const symptomLabels = pd.symptoms.map(id => {
                    const s = PERIOD_SYMPTOMS.find(ps => ps.id === id);
                    return s ? `${s.emoji} ${s.label}` : id;
                });
                symptomText = `\n${userName}的经期反应：${symptomLabels.join('、')}`;
            }

            let customNote = '';
            if (pd.customNote && pd.customNote.trim()) {
                customNote = `\n你恋人的备注：${pd.customNote.trim()}`;
            }

            blocks.push(
                `经期提醒：${userName}目前正处于经期中（Day ${status.dayOfPeriod}/${pd.periodDays}，${startDate} ~ ${endStr}）。${symptomText}${customNote}
请在互动中自然地体现关心和体贴，不需要刻意强调经期本身。`
            );
        }
    }

    // ── Holiday block ──────────────────────────────────────────
    const holidays = getHolidaysForDate(today);
    if (holidays.length > 0) {
        const holidayText = holidays.map(h => h.name).join('、');
        blocks.push(
            `今天是${holidayText}。你可以在合适的时机自然地提起。`
        );
    }

    // ── Date awareness ─────────────────────────────────────────
    blocks.push(dateLine);

    return `\n<gf_calendar>\n【日历系统 · 现实世界感知】\n${blocks.join('\n\n')}\n</gf_calendar>`;
}

// ═══════════════════════════════════════════════════════════════════════
// World Book Injection — 近期事件预告
// ═══════════════════════════════════════════════════════════════════════

const CAL_WI_LOG = '[日历WI]';

/**
 * 将近期事件预告注入世界书条目 <gf_calendar_upcoming>。
 * 让角色主动知道未来 N 天内有什么事件。
 * 由 Settings App 中的开关控制，参考 momentsWorldInfo / treeWorldInfo 模式。
 */
export async function updateCalendarWorldInfo() {
    try {
        const { saveWorldInfo, loadWorldInfo } = await import('../../../../../../world-info.js');
        const { findActiveWorldBook } = await import('../../utils.js');

        const worldBookName = await findActiveWorldBook();
        if (!worldBookName) {
            console.warn(`${CAL_WI_LOG} 未找到活跃的世界书`);
            return;
        }

        const WI_KEY = 'm_calendar';
        const wb = await loadWorldInfo(worldBookName);
        let targetEntry = Object.values(wb.entries).find(e => e.key && e.key.includes(WI_KEY));

        const wiSettings = loadWISettings();

        // If disabled → disable entry and return
        if (!wiSettings.enabled) {
            if (targetEntry && !targetEntry.disable) {
                targetEntry.disable = true;
                await saveWorldInfo(worldBookName, wb);
                console.log(`${CAL_WI_LOG} 世界书条目已禁用`);
            }
            return;
        }

        // Get upcoming events
        const upcoming = getUpcomingEvents(wiSettings.lookAheadDays);

        // No events → disable entry
        if (upcoming.length === 0) {
            if (targetEntry && !targetEntry.disable) {
                targetEntry.disable = true;
                await saveWorldInfo(worldBookName, wb);
                console.log(`${CAL_WI_LOG} 无近期事件，条目已禁用`);
            }
            return;
        }

        // Format event list
        const eventLines = upcoming.map(ev => {
            const d = new Date(ev.date + 'T00:00:00');
            const m = d.getMonth() + 1;
            const day = d.getDate();
            const wd = WEEKDAYS[d.getDay()];
            return `${m}/${day} (周${wd}): ${ev.emoji} ${ev.title}`;
        }).join('\n');

        const entryContent = `
<gf_calendar_upcoming>
【日历系统 · 近期事件预告】
以下是未来${wiSettings.lookAheadDays}天内的日历事件，{{char}}可以在合适的时机自然地提起：

${eventLines}
</gf_calendar_upcoming>
`;

        if (!targetEntry) {
            // Create new entry
            let maxId = 0;
            Object.keys(wb.entries).forEach(id => {
                const num = parseInt(id);
                if (!isNaN(num) && num > maxId) maxId = num;
            });
            const newId = maxId + 1;

            wb.entries[newId] = {
                uid: newId,
                key: [WI_KEY, '日历'],
                comment: '日历近期事件预告 (Auto-generated)',
                content: entryContent,
                constant: true,
                position: 4,
                depth: 1,
                order: 995,
                disable: false,
                excludeRecursion: true,
                preventRecursion: true,
                displayIndex: 0,
            };
        } else {
            // Update existing entry
            targetEntry.content = entryContent;
            targetEntry.disable = false;
            targetEntry.constant = true;
            targetEntry.position = 4;
            targetEntry.depth = 1;
            targetEntry.order = 995;
            targetEntry.excludeRecursion = true;
            targetEntry.preventRecursion = true;
        }

        await saveWorldInfo(worldBookName, wb);
        console.log(`${CAL_WI_LOG} 世界书条目已更新：${upcoming.length} 个事件（未来 ${wiSettings.lookAheadDays} 天）`);
    } catch (e) {
        console.warn(`${CAL_WI_LOG} updateCalendarWorldInfo failed:`, e);
    }
}

/**
 * 禁用日历的世界书条目（关闭开关时调用）
 */
export async function disableCalendarWorldInfo() {
    try {
        const { saveWorldInfo, loadWorldInfo } = await import('../../../../../../world-info.js');
        const { findActiveWorldBook } = await import('../../utils.js');

        const worldBookName = await findActiveWorldBook();
        if (!worldBookName) return;

        const wb = await loadWorldInfo(worldBookName);
        const targetEntry = Object.values(wb.entries).find(e => e.key && e.key.includes('m_calendar'));

        if (targetEntry && !targetEntry.disable) {
            targetEntry.disable = true;
            await saveWorldInfo(worldBookName, wb);
            console.log(`${CAL_WI_LOG} 世界书条目已禁用`);
        }
    } catch (e) {
        console.warn(`${CAL_WI_LOG} disableCalendarWorldInfo failed:`, e);
    }
}
