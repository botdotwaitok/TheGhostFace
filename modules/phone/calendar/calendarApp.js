// modules/phone/calendar/calendarApp.js — 日历 App 主入口
// 月历视图 + 事件管理 + 经期追踪 + 活动检测 + 节日显示

import { openAppInViewport } from '../phoneController.js';
import { getPhoneUserName } from '../phoneContext.js';
import {
    EVENT_TYPES, PERIOD_SYMPTOMS,
    loadEvents, saveEvents, addEvent, deleteEvent,
    loadPeriodData, savePeriodData, loadWISettings,
    getPeriodStatusForDate, getHolidaysForDate,
    getMarkersForMonth, getLocalDateString, parseDate,
    getActivityForDate, fetchCloudHolidays,
} from './calendarStorage.js';
import { updateCalendarWorldInfo } from './calendarWorldInfo.js';


// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

let _calYear, _calMonth; // currently displayed month

/** Trigger WI update if calendar WI injection is enabled */
function _triggerWIUpdateIfEnabled() {
    const ws = loadWISettings();
    if (ws.enabled) {
        updateCalendarWorldInfo().catch(() => { });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// App Entry
// ═══════════════════════════════════════════════════════════════════════

export function openCalendarApp() {
    const now = new Date();
    _calYear = now.getFullYear();
    _calMonth = now.getMonth();

    const html = buildCalendarPage();
    openAppInViewport('日历', html, () => {
        renderMonth(_calYear, _calMonth);
        renderUpcoming();
        bindCalendarEvents();
        _updatePeriodIcon();
    });

    // Fetch cloud holidays in background, then re-render if we got new data
    fetchCloudHolidays().then(holidays => {
        if (holidays && holidays.length > 0) {
            renderMonth(_calYear, _calMonth);
            renderUpcoming();
        }
    }).catch(() => { });
}

// ═══════════════════════════════════════════════════════════════════════
// HTML Builders
// ═══════════════════════════════════════════════════════════════════════

function buildCalendarPage() {
    const now = new Date();
    return `
    <div class="cal-page" id="cal_page_root">
        <div class="cal-scroll-content">
            <!-- Header -->
            <div class="cal-header">
                <div>
                    <div class="cal-header-title">日历</div>
                    <div class="cal-header-subtitle">Calendar ♡</div>
                </div>
                <div class="cal-header-actions">
                    <button class="cal-header-btn cal-btn-settings" id="cal_period_btn" title="经期设置">
                        <i class="fa-solid fa-heart-pulse"></i>
                    </button>
                    <button class="cal-header-btn cal-btn-add" id="cal_add_btn" title="添加事件">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            </div>

            <!-- Month Nav -->
            <div class="cal-month-nav">
                <button class="cal-month-nav-btn" id="cal_prev_month">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <span class="cal-month-label" id="cal_month_label">${now.getFullYear()}年${now.getMonth() + 1}月</span>
                <button class="cal-month-nav-btn" id="cal_next_month">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>

            <!-- Weekday Headers -->
            <div class="cal-weekdays">
                <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
            </div>

            <!-- Calendar Grid -->
            <div class="cal-grid" id="cal_grid"></div>

            <!-- Legend -->
            <div class="cal-legend">
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#f8a4b8"></div>日记</div>
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#65d552"></div>聊天</div>
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#2d936c"></div>树树</div>
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#ff6b6b"></div>经期</div>
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#5b9bd5"></div>事件</div>
                <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#ffa726"></div>节日</div>
            </div>

            <!-- Upcoming -->
            <div class="cal-upcoming-section">
                <div class="cal-upcoming-title">📌 近期事件</div>
                <div class="cal-upcoming-list" id="cal_upcoming_list"></div>
            </div>
        </div>

        <!-- Day Detail Overlay -->
        <div class="cal-day-overlay" id="cal_day_overlay">
            <div class="cal-day-overlay-spacer" id="cal_day_overlay_bg"></div>
            <div class="cal-day-sheet">
                <div class="cal-day-sheet-handle"></div>
                <div class="cal-day-sheet-header">
                    <span class="cal-day-sheet-date" id="cal_day_sheet_date"></span>
                    <button class="cal-day-sheet-close" id="cal_day_sheet_close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="cal-day-sheet-body" id="cal_day_sheet_body"></div>
            </div>
        </div>

        <!-- Add Event Overlay -->
        ${buildAddEventOverlay()}

        <!-- Period Settings Overlay -->
        ${buildPeriodOverlay()}
    </div>
    `;
}

function buildAddEventOverlay() {
    const today = getLocalDateString();
    const typesHtml = EVENT_TYPES
        .filter(t => t.id !== 'holiday') // holidays are auto-detected, not user-created
        .map(t => `
        <div class="cal-type-card ${t.id === 'custom' ? 'type-selected' : ''}" data-type="${t.id}">
            <div class="cal-type-emoji">${t.emoji}</div>
            <div class="cal-type-label">${t.label}</div>
        </div>
    `).join('');

    return `
    <div class="cal-add-overlay" id="cal_add_overlay">
        <div class="cal-add-body">
            <div class="cal-add-section">
                <div class="cal-add-label">类型</div>
                <div class="cal-type-grid" id="cal_type_grid">
                    ${typesHtml}
                </div>
            </div>

            <div class="cal-add-section">
                <div class="cal-add-label">标题</div>
                <input type="text" class="cal-add-input" id="cal_add_title_input"
                    placeholder="事件标题…" maxlength="50" />
            </div>

            <div class="cal-add-section">
                <div class="cal-add-label">日期</div>
                <div class="cal-add-date-row">
                    <input type="date" id="cal_add_start_date" value="${today}" />
                    <span class="cal-add-date-sep">至</span>
                    <input type="date" id="cal_add_end_date" value="${today}" />
                </div>
            </div>

            <div class="cal-add-section">
                <div class="cal-add-label">备注（可选）</div>
                <input type="text" class="cal-add-input" id="cal_add_note_input"
                    placeholder="添加备注…" maxlength="100" />
            </div>
        </div>
    </div>
    `;
}

function buildPeriodOverlay() {
    const pd = loadPeriodData();

    const symptomsHtml = PERIOD_SYMPTOMS.map(s => `
        <div class="cal-symptom-chip ${pd.symptoms.includes(s.id) ? 'symptom-selected' : ''}"
             data-symptom="${s.id}">
            <span class="cal-symptom-emoji">${s.emoji}</span>
            <span>${s.label}</span>
        </div>
    `).join('');

    const historyHtml = pd.periodStarts.length > 0
        ? pd.periodStarts.slice().sort().reverse().map(d => `
            <div class="cal-period-history-item" data-date="${d}">
                <span class="cal-period-history-date">🩸 ${d}</span>
                <button class="cal-period-history-delete" data-date="${d}" title="删除">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `).join('')
        : '<div style="font-size:13px;color:#ccc;text-align:center;padding:8px 0;">暂无记录</div>';

    return `
    <div class="cal-period-overlay" id="cal_period_overlay">
        <div class="cal-period-body">
            <!-- Enable toggle -->
            <div class="cal-period-section">
                <div class="cal-period-toggle-row">
                    <div>
                        <div class="cal-period-toggle-text">启用经期追踪</div>
                        <div class="cal-period-toggle-hint">在日历上显示经期范围</div>
                    </div>
                    <div class="cal-toggle ${pd.enabled ? 'toggle-on' : ''}" id="cal_period_enabled_toggle"></div>
                </div>
            </div>

            <!-- Prompt injection toggle -->
            <div class="cal-period-section">
                <div class="cal-period-toggle-row">
                    <div>
                        <div class="cal-period-toggle-text">指示注入</div>
                        <div class="cal-period-toggle-hint">经期期间自动提醒你对象关心你</div>
                    </div>
                    <div class="cal-toggle ${pd.promptInjection ? 'toggle-on' : ''}" id="cal_period_prompt_toggle"></div>
                </div>
            </div>

            <!-- Duration settings -->
            <div class="cal-period-section">
                <div class="cal-period-label">周期设置</div>
                <div class="cal-period-num-row">
                    <span class="cal-period-num-label">经期天数</span>
                    <input type="number" class="cal-period-num-input" id="cal_period_days"
                        value="${pd.periodDays}" min="1" max="14" />
                    <span class="cal-period-num-unit">天</span>
                </div>
                <div class="cal-period-num-row">
                    <span class="cal-period-num-label">周期天数</span>
                    <input type="number" class="cal-period-num-input" id="cal_cycle_days"
                        value="${pd.cycleDays}" min="14" max="60" />
                    <span class="cal-period-num-unit">天</span>
                </div>
            </div>

            <!-- Symptom selection -->
            <div class="cal-period-section">
                <div class="cal-period-label">你的经期反应</div>
                <div class="cal-symptom-grid" id="cal_symptom_grid">
                    ${symptomsHtml}
                </div>
            </div>

            <!-- Custom note -->
            <div class="cal-period-section">
                <div class="cal-period-label">自定义备注（给你对象的提示）</div>
                <textarea class="cal-period-textarea" id="cal_period_note"
                    placeholder="例如：我经期不太疼，但是会很想阉小烟头…&#10;你对象会根据这些信息自然地关心你 ♡"
                >${pd.customNote || ''}</textarea>
                <div class="cal-prompt-preview-label">预览注入效果：</div>
                <div class="cal-prompt-preview" id="cal_prompt_preview">
                    ${buildPromptPreview(pd)}
                </div>
            </div>

            <!-- Period history -->
            <div class="cal-period-section">
                <div class="cal-period-label">经期记录</div>
                <div class="cal-period-history" id="cal_period_history">
                    ${historyHtml}
                </div>
                <button class="cal-period-add-btn" id="cal_period_add_start">
                    <i class="fa-solid fa-plus"></i> 添加经期开始日期
                </button>
            </div>
        </div>
    </div>
    `;
}

function buildPromptPreview(pd) {
    if (!pd.enabled) return '<em>经期追踪未启用</em>';
    if (pd.periodStarts.length === 0) return '<em>暂无经期记录</em>';

    const userName = getPhoneUserName() || '用户';
    let text = `🩸 经期提醒：${userName}目前正处于经期中。`;

    if (pd.symptoms && pd.symptoms.length > 0) {
        const labels = pd.symptoms.map(id => {
            const s = PERIOD_SYMPTOMS.find(ps => ps.id === id);
            return s ? `${s.emoji} ${s.label}` : id;
        });
        text += `\n${userName}的经期反应：${labels.join('、')}`;
    }

    if (pd.customNote && pd.customNote.trim()) {
        text += `\n用户备注：${pd.customNote.trim()}`;
    }

    text += '\n请在互动中自然地体现关心。';
    return escHtml(text).replace(/\n/g, '<br>');
}

// ═══════════════════════════════════════════════════════════════════════
// Month Rendering
// ═══════════════════════════════════════════════════════════════════════

function renderMonth(year, month) {
    const grid = document.getElementById('cal_grid');
    const label = document.getElementById('cal_month_label');
    if (!grid || !label) return;

    label.textContent = `${year}年${month + 1}月`;

    const markers = getMarkersForMonth(year, month);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getLocalDateString();

    let html = '';

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="cal-cell cal-cell-empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayOfWeek = new Date(year, month, d).getDay();
        const isToday = dateStr === todayStr;
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const dayMarkers = markers.get(d) || [];

        const hasPeriod = dayMarkers.some(m => m.type === 'period');
        const hasHoliday = dayMarkers.some(m => m.type === 'holiday');

        const classes = [
            'cal-cell',
            isToday ? 'cal-cell-today' : '',
            isWeekend ? 'cal-cell-weekend' : '',
            hasPeriod ? 'cal-cell-period' : '',
            hasHoliday ? 'cal-cell-holiday' : '',
        ].filter(Boolean).join(' ');

        // Build dots (max 4)
        const dots = dayMarkers
            .slice(0, 4)
            .map(m => `<div class="cal-dot" style="background:${m.color}"></div>`)
            .join('');

        html += `
        <div class="${classes}" data-date="${dateStr}">
            <div class="cal-cell-day">${d}</div>
            <div class="cal-cell-dots">${dots}</div>
        </div>`;
    }

    grid.innerHTML = html;

    // Bind click events
    grid.querySelectorAll('.cal-cell:not(.cal-cell-empty)').forEach(cell => {
        cell.addEventListener('click', () => {
            openDayDetail(cell.dataset.date);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Upcoming Events
// ═══════════════════════════════════════════════════════════════════════

function renderUpcoming() {
    const list = document.getElementById('cal_upcoming_list');
    if (!list) return;

    const events = loadEvents();
    const today = getLocalDateString();

    // Filter future + today events, sort by start date
    const upcoming = events
        .filter(e => e.endDate >= today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 8);

    // Also add upcoming holidays (next 30 days)
    const holidayItems = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dateStr = getLocalDateString(d);
        const holidays = getHolidaysForDate(dateStr);
        for (const h of holidays) {
            holidayItems.push({
                id: -1,
                title: h.name,
                emoji: h.emoji,
                startDate: dateStr,
                endDate: dateStr,
                type: 'holiday',
            });
        }
    }

    const combined = [...upcoming, ...holidayItems]
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 10);

    if (combined.length === 0) {
        list.innerHTML = '<div class="cal-upcoming-empty">暂无近期事件 ♡</div>';
        return;
    }

    list.innerHTML = combined.map(ev => {
        const typeInfo = EVENT_TYPES.find(t => t.id === ev.type);
        const emoji = ev.emoji || typeInfo?.emoji || '📌';
        const dateLabel = ev.startDate === ev.endDate
            ? formatShortDate(ev.startDate)
            : `${formatShortDate(ev.startDate)} ~ ${formatShortDate(ev.endDate)}`;

        const deleteBtn = ev.id > 0
            ? `<button class="cal-upcoming-delete" data-event-id="${ev.id}" title="删除">
                   <i class="fa-solid fa-xmark"></i>
               </button>`
            : '';

        return `
        <div class="cal-upcoming-item">
            <div class="cal-upcoming-emoji">${emoji}</div>
            <div class="cal-upcoming-info">
                <div class="cal-upcoming-name">${escHtml(ev.title)}</div>
                <div class="cal-upcoming-date">${dateLabel}</div>
            </div>
            ${deleteBtn}
        </div>`;
    }).join('');

    // Delete buttons
    list.querySelectorAll('.cal-upcoming-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.eventId);
            if (id && confirm('确定要删除这个事件吗？')) {
                deleteEvent(id);
                renderUpcoming();
                renderMonth(_calYear, _calMonth);
                _triggerWIUpdateIfEnabled();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Day Detail
// ═══════════════════════════════════════════════════════════════════════

function openDayDetail(dateStr) {
    const overlay = document.getElementById('cal_day_overlay');
    const dateLabel = document.getElementById('cal_day_sheet_date');
    const body = document.getElementById('cal_day_sheet_body');
    if (!overlay || !body) return;

    // Format date
    const d = parseDate(dateStr);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    dateLabel.textContent = `${d.getMonth() + 1}月${d.getDate()}日 · 周${weekdays[d.getDay()]}`;

    // Gather all info for this date
    const sections = [];

    // Period
    const ps = getPeriodStatusForDate(dateStr);
    if (ps) {
        sections.push({
            label: '经期',
            items: [{
                emoji: '🩸',
                text: `经期 Day ${ps.dayOfPeriod}`,
                color: '#ff6b6b',
                deletable: true,
                deleteAttr: `data-period-start="${ps.periodStart}"`,
            }],
        });
    }

    // Holidays
    const holidays = getHolidaysForDate(dateStr);
    if (holidays.length > 0) {
        sections.push({
            label: '节日',
            items: holidays.map(h => ({ emoji: h.emoji, text: h.name, color: '#ffa726' })),
        });
    }

    // User events
    const events = loadEvents();
    const dayEvents = events.filter(e => dateStr >= e.startDate && dateStr <= e.endDate);
    if (dayEvents.length > 0) {
        sections.push({
            label: '事件',
            items: dayEvents.map(e => {
                const typeInfo = EVENT_TYPES.find(t => t.id === e.type);
                return {
                    emoji: e.emoji || typeInfo?.emoji || '📌',
                    text: e.title + (e.note ? ` · ${e.note}` : ''),
                    color: e.color || typeInfo?.color || '#5b9bd5',
                };
            }),
        });
    }

    // Activities
    const acts = getActivityForDate(dateStr);
    const actItems = [];
    if (acts.diary) actItems.push({ emoji: '📓', text: '写了日记', color: '#f8a4b8' });
    if (acts.chat) actItems.push({ emoji: '💬', text: '聊天了', color: '#65d552' });
    if (acts.tree) actItems.push({ emoji: '🌳', text: '照顾了树树', color: '#2d936c' });
    if (actItems.length > 0) {
        sections.push({ label: '今日活动', items: actItems });
    }

    if (sections.length === 0) {
        body.innerHTML = '<div class="cal-day-empty"><i class="ph ph-cloud"></i> 这天什么都没有呢</div>';
    } else {
        body.innerHTML = sections.map(sec => `
            <div class="cal-day-section">
                <div class="cal-day-section-label">${sec.label}</div>
                ${sec.items.map(item => `
                    <div class="cal-day-item">
                        <div class="cal-day-item-emoji">${item.emoji}</div>
                        <div class="cal-day-item-dot" style="background:${item.color}"></div>
                        <div class="cal-day-item-text">${escHtml(item.text)}</div>
                        ${item.deletable ? `<button class="cal-upcoming-delete cal-day-delete-period" ${item.deleteAttr} title="删除"><i class="fa-solid fa-xmark"></i></button>` : ''}
                    </div>
                `).join('')}
            </div>
        `).join('');

        // Bind period delete buttons
        body.querySelectorAll('.cal-day-delete-period').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const startDate = btn.dataset.periodStart;
                if (!startDate || !confirm('确定要删除这条经期记录吗？')) return;
                const pd = loadPeriodData();
                pd.periodStarts = pd.periodStarts.filter(d => d !== startDate);
                savePeriodData(pd);
                closeDayDetail();
                renderMonth(_calYear, _calMonth);
                renderUpcoming();
                _updatePeriodIcon();
            });
        });
    }

    overlay.classList.add('day-active');
}

// ═══════════════════════════════════════════════════════════════════════
// Event Binding
// ═══════════════════════════════════════════════════════════════════════

function bindCalendarEvents() {
    // Month navigation
    onClick('cal_prev_month', () => {
        _calMonth--;
        if (_calMonth < 0) { _calMonth = 11; _calYear--; }
        renderMonth(_calYear, _calMonth);
    });
    onClick('cal_next_month', () => {
        _calMonth++;
        if (_calMonth > 11) { _calMonth = 0; _calYear++; }
        renderMonth(_calYear, _calMonth);
    });

    // Day detail close
    onClick('cal_day_sheet_close', closeDayDetail);
    onClick('cal_day_overlay_bg', closeDayDetail);

    // Add event
    onClick('cal_add_btn', openAddEvent);
    bindTypeSelector();

    // Period settings
    onClick('cal_period_btn', openPeriodSettings);
    bindPeriodToggles();
    bindSymptomChips();
    bindPeriodHistory();
    bindPromptPreviewUpdate();
}

function closeDayDetail() {
    const overlay = document.getElementById('cal_day_overlay');
    if (overlay) overlay.classList.remove('day-active');
}

// ── Add Event ───────────────────────────────────────────────────────

let _selectedEventType = 'custom';

function openAddEvent() {
    const overlay = document.getElementById('cal_add_overlay');
    if (overlay) overlay.classList.add('add-active');
    // Reset form
    _selectedEventType = 'custom';
    const titleInput = document.getElementById('cal_add_title_input');
    const noteInput = document.getElementById('cal_add_note_input');
    if (titleInput) titleInput.value = '';
    if (noteInput) noteInput.value = '';

    const today = getLocalDateString();
    const startDate = document.getElementById('cal_add_start_date');
    const endDate = document.getElementById('cal_add_end_date');
    if (startDate) startDate.value = today;
    if (endDate) endDate.value = today;

    // Reset type selection
    document.querySelectorAll('.cal-type-card').forEach(card => {
        card.classList.toggle('type-selected', card.dataset.type === 'custom');
    });

    // Update native viewport header
    _setNativeHeader('添加事件', `<button class="phone-app-back-btn" id="cal_add_save_native" style="color:#ff6b6b;font-weight:600;">保存</button>`);
    document.getElementById('cal_add_save_native')?.addEventListener('click', saveNewEvent);
}

function closeAddEvent() {
    const overlay = document.getElementById('cal_add_overlay');
    if (overlay) overlay.classList.remove('add-active');
    _resetNativeHeader();
}

function bindTypeSelector() {
    const grid = document.getElementById('cal_type_grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.cal-type-card');
        if (!card) return;
        _selectedEventType = card.dataset.type;
        grid.querySelectorAll('.cal-type-card').forEach(c =>
            c.classList.toggle('type-selected', c === card)
        );
    });
}

function saveNewEvent() {
    const titleInput = document.getElementById('cal_add_title_input');
    const startInput = document.getElementById('cal_add_start_date');
    const endInput = document.getElementById('cal_add_end_date');
    const noteInput = document.getElementById('cal_add_note_input');

    const title = titleInput?.value?.trim();
    if (!title) {
        titleInput?.focus();
        return;
    }

    const startDate = startInput?.value || getLocalDateString();
    let endDate = endInput?.value || startDate;
    if (endDate < startDate) endDate = startDate;

    const typeInfo = EVENT_TYPES.find(t => t.id === _selectedEventType);

    const ev = {
        title,
        startDate,
        endDate,
        type: _selectedEventType,
        color: typeInfo?.color || '#5b9bd5',
        emoji: typeInfo?.emoji || '📌',
        recurring: _selectedEventType === 'anniversary' || _selectedEventType === 'birthday' ? 'yearly' : 'none',
        note: noteInput?.value?.trim() || '',
    };

    // If it's a period start event, also add to period data
    if (_selectedEventType === 'period') {
        const pd = loadPeriodData();
        if (!pd.periodStarts.includes(startDate)) {
            pd.periodStarts.push(startDate);
            pd.enabled = true; // auto-enable
            savePeriodData(pd);

        }
    }

    addEvent(ev);
    closeAddEvent();
    renderMonth(_calYear, _calMonth);
    renderUpcoming();
    _triggerWIUpdateIfEnabled();
}

// ── Period Settings ─────────────────────────────────────────────────

function openPeriodSettings() {
    const overlay = document.getElementById('cal_period_overlay');
    if (overlay) overlay.classList.add('period-active');
    _setNativeHeader('🩸 经期设置', `<button class="phone-app-back-btn" id="cal_period_save_native" style="color:#ff6b6b;font-weight:600;">保存</button>`);
    document.getElementById('cal_period_save_native')?.addEventListener('click', savePeriodSettings);
}

function closePeriodSettings() {
    const overlay = document.getElementById('cal_period_overlay');
    if (overlay) overlay.classList.remove('period-active');
    _resetNativeHeader();
    _updatePeriodIcon();
}

function bindPeriodToggles() {
    const enabledToggle = document.getElementById('cal_period_enabled_toggle');
    const promptToggle = document.getElementById('cal_period_prompt_toggle');

    if (enabledToggle) {
        enabledToggle.addEventListener('click', () => {
            enabledToggle.classList.toggle('toggle-on');
        });
    }
    if (promptToggle) {
        promptToggle.addEventListener('click', () => {
            promptToggle.classList.toggle('toggle-on');
        });
    }
}

function bindSymptomChips() {
    const grid = document.getElementById('cal_symptom_grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
        const chip = e.target.closest('.cal-symptom-chip');
        if (!chip) return;
        chip.classList.toggle('symptom-selected');
        updatePromptPreview();
    });
}

function bindPeriodHistory() {
    const history = document.getElementById('cal_period_history');
    if (history) {
        history.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.cal-period-history-delete');
            if (!deleteBtn) return;
            const date = deleteBtn.dataset.date;
            if (!date) return;
            // Remove from UI
            const item = deleteBtn.closest('.cal-period-history-item');
            if (item) item.remove();
        });
    }

    const addBtn = document.getElementById('cal_period_add_start');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const dateStr = prompt('请输入经期开始日期 (YYYY-MM-DD)：', getLocalDateString());
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;

            const history = document.getElementById('cal_period_history');
            if (!history) return;

            // Remove the empty state message if present
            const emptyMsg = history.querySelector('div[style]');
            if (emptyMsg) emptyMsg.remove();

            const itemHtml = `
                <div class="cal-period-history-item" data-date="${dateStr}">
                    <span class="cal-period-history-date">🩸 ${dateStr}</span>
                    <button class="cal-period-history-delete" data-date="${dateStr}" title="删除">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `;
            history.insertAdjacentHTML('afterbegin', itemHtml);
        });
    }
}

function bindPromptPreviewUpdate() {
    // Update preview when custom note changes
    const noteArea = document.getElementById('cal_period_note');
    if (noteArea) {
        noteArea.addEventListener('input', () => {
            updatePromptPreview();
        });
    }
}

function updatePromptPreview() {
    const preview = document.getElementById('cal_prompt_preview');
    if (!preview) return;

    // Build a temporary pd from current UI state
    const pd = {
        enabled: document.getElementById('cal_period_enabled_toggle')?.classList.contains('toggle-on') || false,
        periodStarts: [],
        symptoms: [],
        customNote: document.getElementById('cal_period_note')?.value || '',
    };

    // Gather symptoms
    document.querySelectorAll('#cal_symptom_grid .cal-symptom-chip.symptom-selected').forEach(chip => {
        pd.symptoms.push(chip.dataset.symptom);
    });

    // Gather period starts from history
    document.querySelectorAll('#cal_period_history .cal-period-history-item').forEach(item => {
        pd.periodStarts.push(item.dataset.date);
    });

    preview.innerHTML = buildPromptPreview(pd);
}

function savePeriodSettings() {
    const pd = loadPeriodData();

    // Enabled
    pd.enabled = document.getElementById('cal_period_enabled_toggle')?.classList.contains('toggle-on') || false;

    // Prompt injection
    pd.promptInjection = document.getElementById('cal_period_prompt_toggle')?.classList.contains('toggle-on') || false;

    // Duration
    pd.periodDays = parseInt(document.getElementById('cal_period_days')?.value) || 5;
    pd.cycleDays = parseInt(document.getElementById('cal_cycle_days')?.value) || 28;

    // Symptoms
    pd.symptoms = [];
    document.querySelectorAll('#cal_symptom_grid .cal-symptom-chip.symptom-selected').forEach(chip => {
        pd.symptoms.push(chip.dataset.symptom);
    });

    // Custom note
    pd.customNote = document.getElementById('cal_period_note')?.value || '';

    // Period starts from history UI
    pd.periodStarts = [];
    document.querySelectorAll('#cal_period_history .cal-period-history-item').forEach(item => {
        pd.periodStarts.push(item.dataset.date);
    });

    savePeriodData(pd);
    closePeriodSettings();
    renderMonth(_calYear, _calMonth);
    renderUpcoming();
    _triggerWIUpdateIfEnabled();


}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function onClick(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

/** Update the phone native viewport header title and right-side actions */
function _setNativeHeader(title, actionsHtml = '') {
    const titleEl = document.getElementById('phone_app_viewport_title');
    const actionsEl = document.getElementById('phone_app_viewport_actions');
    if (titleEl) titleEl.textContent = title;
    if (actionsEl) actionsEl.innerHTML = actionsHtml;
}

/** Reset the phone native viewport header back to '日历' */
function _resetNativeHeader() {
    const titleEl = document.getElementById('phone_app_viewport_title');
    const actionsEl = document.getElementById('phone_app_viewport_actions');
    if (titleEl) titleEl.textContent = '日历';
    if (actionsEl) actionsEl.innerHTML = '';
}

/** Update the period settings icon to red when period tracking is enabled */
function _updatePeriodIcon() {
    const btn = document.getElementById('cal_period_btn');
    if (!btn) return;
    const pd = loadPeriodData();
    btn.classList.toggle('cal-btn-settings--active', pd.enabled);
}

function formatShortDate(dateStr) {
    const d = parseDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);

    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';

    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Back Button Hijack
// ═══════════════════════════════════════════════════════════════════════

window.addEventListener('phone-app-back', (e) => {
    // Day detail
    const dayOverlay = document.getElementById('cal_day_overlay');
    if (dayOverlay?.classList.contains('day-active')) {
        e.preventDefault();
        closeDayDetail();
        return;
    }

    // Add event
    const addOverlay = document.getElementById('cal_add_overlay');
    if (addOverlay?.classList.contains('add-active')) {
        e.preventDefault();
        closeAddEvent();
        return;
    }

    // Period settings
    const periodOverlay = document.getElementById('cal_period_overlay');
    if (periodOverlay?.classList.contains('period-active')) {
        e.preventDefault();
        closePeriodSettings();
        return;
    }
});
