// modules/phone/calendar/calendarWorldInfo.js — 日历 Prompt 注入
// 经期提醒 + 节日提醒 + 日期感知 → 直接拼入 system prompt，让角色感知现实世界
// 不再通过世界书注入，而是作为纯函数由 chatPromptBuilder 调用。

import { getPhoneUserName } from '../phoneContext.js';
import {
    loadPeriodData, isTodayInPeriod,
    getHolidaysForDate, getLocalDateString, PERIOD_SYMPTOMS,
} from './calendarStorage.js';

/** 每日只注入一次经期/节日提醒，避免角色反复提及 */
let _lastInjectedDate = '';

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
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateLine = `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日，星期${weekdays[now.getDay()]}。`;

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
                customNote = `\n用户备注：${pd.customNote.trim()}`;
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
