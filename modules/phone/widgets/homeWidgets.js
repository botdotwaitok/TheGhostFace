// modules/phone/widgets/homeWidgets.js — 主屏 Widget 控制器
// 管理日历 Widget（实时日期+事件）和备忘录 Widget（日记/树树完成状态）

import { openCalendarApp } from '../calendar/calendarApp.js';
import {
    getLocalDateString, getActivityForDate,
    loadEvents, getHolidaysForDate,
} from '../calendar/calendarStorage.js';

const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const WEEKDAY_NAMES_CN = ['日', '一', '二', '三', '四', '五', '六'];

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Refresh all home-screen widgets with live data.
 * Called every time the phone is opened (in phoneController.openPhone).
 */
export function updateWidgets() {
    _updateCalendarWidget();
    _updateMemoWidget();
    _bindWidgetClicks();
}

// ═══════════════════════════════════════════════════════════════════════
// Calendar Widget
// ═══════════════════════════════════════════════════════════════════════

function _updateCalendarWidget() {
    const now = new Date();
    const todayStr = getLocalDateString(now);

    // Day name (e.g. "SATURDAY")
    const dayNameEl = document.querySelector('.calendar-widget .calendar-day-name');
    if (dayNameEl) {
        dayNameEl.textContent = WEEKDAY_NAMES[now.getDay()];
    }

    // Date number (e.g. "14")
    const dateNumEl = document.querySelector('.calendar-widget .calendar-date-number');
    if (dateNumEl) {
        dateNumEl.textContent = now.getDate();
    }

    // Events summary
    const eventsEl = document.querySelector('.calendar-widget .calendar-events');
    if (eventsEl) {
        const summary = _getTodayEventSummary(todayStr);
        eventsEl.textContent = summary;
    }
}

/**
 * Get a one-line summary of today's events for the widget.
 */
function _getTodayEventSummary(todayStr) {
    // Check user events
    const events = loadEvents();
    const todayEvents = events.filter(e => todayStr >= e.startDate && todayStr <= e.endDate);

    // Check holidays
    const holidays = getHolidaysForDate(todayStr);

    const items = [];

    // Holidays first
    for (const h of holidays) {
        items.push(h.name);
    }

    // User events
    for (const e of todayEvents) {
        items.push(e.title);
    }

    if (items.length === 0) return 'No events today';
    if (items.length === 1) return items[0];
    return `${items[0]} 等${items.length}个事件`;
}

// ═══════════════════════════════════════════════════════════════════════
// Memo Widget (replaces Weather)
// ═══════════════════════════════════════════════════════════════════════

function _updateMemoWidget() {
    const container = document.querySelector('.memo-widget');
    if (!container) return;

    const todayStr = getLocalDateString();
    const activity = getActivityForDate(todayStr);

    // Update checklist items
    const diaryItem = container.querySelector('[data-memo="diary"]');
    const treeItem = container.querySelector('[data-memo="tree"]');

    if (diaryItem) {
        _setMemoItemStatus(diaryItem, activity.diary);
    }
    if (treeItem) {
        _setMemoItemStatus(treeItem, activity.tree);
    }

    // Update overall status label
    const statusEl = container.querySelector('.memo-status');
    if (statusEl) {
        const doneCount = [activity.diary, activity.tree].filter(Boolean).length;
        if (doneCount === 2) {
            statusEl.textContent = '今日已完成 ♡';
            statusEl.className = 'memo-status memo-all-done';
        } else if (doneCount === 1) {
            statusEl.textContent = '不做也没关系~';
            statusEl.className = 'memo-status memo-partial';
        } else {
            statusEl.textContent = '今日待办';
            statusEl.className = 'memo-status';
        }
    }
}

function _setMemoItemStatus(itemEl, isDone) {
    const iconEl = itemEl.querySelector('.memo-item-icon');
    if (isDone) {
        itemEl.classList.add('memo-item-done');
        itemEl.classList.remove('memo-item-pending');
        if (iconEl) iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    } else {
        itemEl.classList.remove('memo-item-done');
        itemEl.classList.add('memo-item-pending');
        if (iconEl) iconEl.innerHTML = '<i class="fa-regular fa-circle"></i>';
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Click Bindings
// ═══════════════════════════════════════════════════════════════════════

let _widgetClicksBound = false;

function _bindWidgetClicks() {
    if (_widgetClicksBound) return;

    // Calendar widget → open Calendar app
    const calWidget = document.querySelector('.calendar-widget');
    if (calWidget) {
        calWidget.style.cursor = 'pointer';
        calWidget.addEventListener('click', () => {
            openCalendarApp();
        });
    }

    _widgetClicksBound = true;
}
