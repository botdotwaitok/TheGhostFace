// modules/phone/chat/chatSettings.js — ChatSettings second-level page
// Aggregates per-character chat tooling. Phase 1 hosts only the migrated
// "clear chat history" action; search / favorites / stats arrive in later phases.

import { openAppInViewport } from '../phoneController.js';
import { openChatApp } from './chatApp.js';
import { clearChatHistory } from './chatStorage.js';
import { openChatSearchPage } from './chatSearch.js';
import { openChatStatsPage } from './chatStats.js';
import { openChatFavoritesPage } from './chatFavorites.js';
import { openChatImportExportPage } from './chatImportExport.js';
import { openChatSummaryViewPage } from './chatSummaryView.js';
import { openChatVisibilityPage } from './chatVisibility.js';

const LOG = '[ChatSettings]';

let _backHandler = null;

export function openChatSettingsPage() {
    const titleHtml = `<span class="chat-settings-nav-title">聊天设置</span>`;
    const html = _buildPage();

    openAppInViewport(titleHtml, html, () => {
        _bindEvents();
        _registerBackHandler();
    });
}

function _buildPage() {
    return `
    <div class="chat-settings-page" id="chat_settings_root">
        <div class="chat-settings-scroll">

            <!-- Search entry -->
            <div class="chat-settings-section">
                <div class="chat-settings-search-card" id="chat_settings_search_card">
                    <i class="ph ph-magnifying-glass chat-settings-search-icon"></i>
                    <div class="chat-settings-search-text">
                        <div class="chat-settings-search-title">搜索聊天记录</div>
                    </div>
                    <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                </div>
            </div>

            <!-- Combined list: features + advanced -->
            <div class="chat-settings-section">
                <div class="chat-settings-card">
                    <div class="chat-settings-item" id="chat_settings_favorites">
                        <i class="ph ph-bookmark-simple chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">收藏消息</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_settings_stats">
                        <i class="ph ph-chart-bar chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">数据统计</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_settings_summary_view">
                        <i class="ph ph-scroll chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">查看总结</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_settings_visibility">
                        <i class="ph ph-sliders chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">手动调节可见消息</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                    <div class="chat-settings-item" id="chat_settings_importexport">
                        <i class="ph ph-export chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">导入 / 导出</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                </div>
            </div>

            <!-- Danger: clear all chat history -->
            <div class="chat-settings-section">
                <div class="chat-settings-card">
                    <div class="chat-settings-item danger" id="chat_settings_clear_history">
                        <i class="ph ph-trash chat-settings-item-icon"></i>
                        <span class="chat-settings-item-label">清空聊天记录</span>
                        <i class="ph ph-caret-right chat-settings-item-chevron"></i>
                    </div>
                </div>
            </div>

        </div>
    </div>`;
}

function _bindEvents() {
    const searchCard = document.getElementById('chat_settings_search_card');
    if (searchCard) {
        searchCard.addEventListener('click', () => {
            // Hand off back-button ownership to the search page so its handler
            // (return to ChatSettings) doesn't fire alongside ours (return to
            // chat app) on the same back press.
            _unregisterBackHandler();
            openChatSearchPage();
        });
    }

    const statsItem = document.getElementById('chat_settings_stats');
    if (statsItem) {
        statsItem.addEventListener('click', () => {
            _unregisterBackHandler();
            openChatStatsPage();
        });
    }

    const favoritesItem = document.getElementById('chat_settings_favorites');
    if (favoritesItem) {
        favoritesItem.addEventListener('click', () => {
            _unregisterBackHandler();
            openChatFavoritesPage();
        });
    }

    const summaryViewItem = document.getElementById('chat_settings_summary_view');
    if (summaryViewItem) {
        summaryViewItem.addEventListener('click', () => {
            _unregisterBackHandler();
            openChatSummaryViewPage();
        });
    }

    const visibilityItem = document.getElementById('chat_settings_visibility');
    if (visibilityItem) {
        visibilityItem.addEventListener('click', () => {
            _unregisterBackHandler();
            openChatVisibilityPage();
        });
    }

    const importExportItem = document.getElementById('chat_settings_importexport');
    if (importExportItem) {
        importExportItem.addEventListener('click', () => {
            _unregisterBackHandler();
            openChatImportExportPage();
        });
    }

    const clearBtn = document.getElementById('chat_settings_clear_history');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if (!confirm('确定要清空所有聊天记录吗？\n此操作无法撤销。')) return;
            try {
                await clearChatHistory();
            } catch (err) {
                console.error(LOG, 'clearChatHistory failed:', err);
            }
            _unregisterBackHandler();
            openChatApp();
        });
    }

}

function _registerBackHandler() {
    _unregisterBackHandler();
    _backHandler = (e) => {
        e.preventDefault();
        _unregisterBackHandler();
        openChatApp();
    };
    window.addEventListener('phone-app-back', _backHandler);
}

function _unregisterBackHandler() {
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
}
