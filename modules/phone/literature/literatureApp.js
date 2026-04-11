// modules/phone/literature/literatureApp.js — 文学 App 入口
// Two tabs: Reading (阅读) and Writing (写作).

import { openAppInViewport } from '../phoneController.js';
import { renderWritingTab, bindWritingBackButton } from './writingTab.js';
import { renderReadingTab, bindReadingBackButton } from './readingTab.js';

// ═══════════════════════════════════════════════════════════════════════
// App Entry
// ═══════════════════════════════════════════════════════════════════════

/** Opens the Literature App inside the phone viewport */
export function openLiteratureApp() {
    const titleHtml = `
        <div class="lit-header-tabs" id="lit_header_tabs">
            <button class="lit-header-tab" data-tab="reading">
                <span>阅读</span>
            </button>
            <button class="lit-header-tab active" data-tab="writing">
                <span>写作</span>
            </button>
        </div>
        <div class="lit-header-title" id="lit_header_title" style="display:none; font-weight:600; font-size:1.1em; color:#e5d5c5;"></div>
    `;

    const html = _buildMainHTML();

    openAppInViewport(titleHtml, html, () => {
        _bindTabEvents();
        bindWritingBackButton();
        bindReadingBackButton();

        // Default to Writing tab
        _switchTab('writing');
    });
}

// ═══════════════════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════════════════

function _buildMainHTML() {
    return `
        <div class="lit-app" id="lit_app_root">
            <!-- Tab Contents -->
            <div class="lit-tab-content" id="lit_tab_reading">
                <!-- Reading tab content rendered dynamically -->
            </div>
            <div class="lit-tab-content active" id="lit_tab_writing">
                <!-- Writing tab content rendered dynamically -->
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Tab Switching
// ═══════════════════════════════════════════════════════════════════════

function _switchTab(tabId) {
    const root = document.getElementById('lit_app_root');
    if (!root) return;

    // Update tab buttons
    document.querySelectorAll('.lit-header-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
    });

    // Update tab contents
    root.querySelectorAll('.lit-tab-content').forEach(c => {
        c.classList.remove('active');
    });
    const content = document.getElementById(`lit_tab_${tabId}`);
    if (content) content.classList.add('active');

    // Lazy-load tab content
    if (tabId === 'writing') {
        const writingContainer = document.getElementById('lit_tab_writing');
        if (writingContainer) renderWritingTab(writingContainer);
    } else if (tabId === 'reading') {
        const readingContainer = document.getElementById('lit_tab_reading');
        if (readingContainer) renderReadingTab(readingContainer);
    }
}

function _bindTabEvents() {
    document.querySelectorAll('.lit-header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _switchTab(tab.dataset.tab);
        });
    });
}
