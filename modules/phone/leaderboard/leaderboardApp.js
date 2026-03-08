// leaderboard/leaderboardApp.js — 排行榜APP (酒馆专属)
import { openAppInViewport } from '../phoneController.js';

// ── API helper ──
let _apiRequest = null;
async function getApiRequest() {
    if (!_apiRequest) {
        const mod = await import('../moments/apiClient.js');
        _apiRequest = mod.apiRequest;
    }
    return _apiRequest;
}

// ── Tab config ──
const TABS = [
    { id: 'gifter',  icon: 'fa-solid fa-gift',              label: '送礼榜', valueKey: 'total_gifts',   unit: '次送礼',   emptyHint: '还没有角色送过礼物呢！' },
    { id: 'robber',  icon: 'fa-solid fa-skull-crossbones',   label: '土匪榜', valueKey: 'rob_count',     unit: '次抢劫',   emptyHint: '目前还没有人抢劫过！'  },
    { id: 'unlucky', icon: 'fa-solid fa-face-dizzy',         label: '倒楣榜', valueKey: 'counter_count', unit: '次被反杀', emptyHint: '还没有倒楣蛋…好运连连！' },
];

let currentTab = 'gifter';
let cachedData = null;
let isLoading = false;

/** Opens the Leaderboard APP */
export function openLeaderboardApp() {
    cachedData = null; // force fresh load
    currentTab = 'gifter';
    openAppInViewport('排行榜', buildLeaderboardHTML(), () => {
        bindTabEvents();
        fetchLeaderboard();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// HTML
// ═══════════════════════════════════════════════════════════════════════

function buildLeaderboardHTML() {
    const tabsHtml = TABS.map(t => `
        <div class="lb-tab ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}">
            <i class="${t.icon}"></i>
            ${t.label}
        </div>
    `).join('');

    return `
        <div class="lb-container">
            <div class="lb-tabs" id="lb_tabs">${tabsHtml}</div>
            <div class="lb-content" id="lb_content">
                ${buildSkeletonHTML()}
            </div>
        </div>
    `;
}

function buildSkeletonHTML() {
    return `<div class="lb-skeleton-list">${
        Array.from({ length: 6 }, () => `
            <div class="lb-skeleton-item">
                <div class="lb-skeleton-circle"></div>
                <div class="lb-skeleton-bar w60"></div>
                <div class="lb-skeleton-bar w30" style="margin-left:auto;"></div>
            </div>
        `).join('')
    }</div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Data Fetching
// ═══════════════════════════════════════════════════════════════════════

async function fetchLeaderboard() {
    if (isLoading) return;
    isLoading = true;

    const content = document.getElementById('lb_content');
    if (content) content.innerHTML = buildSkeletonHTML();

    try {
        const apiRequest = await getApiRequest();
        const data = await apiRequest('GET', '/api/wallet/leaderboard');
        cachedData = data;
        renderTab();
    } catch (err) {
        console.error('[Leaderboard] fetch error:', err);
        if (content) {
            content.innerHTML = `
                <div class="lb-empty-state">
                    <div class="lb-empty-icon">⚠️</div>
                    <div class="lb-empty-text">排行榜数据加载失败</div>
                    <button class="lb-retry-btn" id="lb_retry">重试</button>
                </div>
            `;
            document.getElementById('lb_retry')?.addEventListener('click', () => {
                fetchLeaderboard();
            });
        }
    } finally {
        isLoading = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════

function renderTab() {
    const content = document.getElementById('lb_content');
    if (!content || !cachedData) return;

    const tabConfig = TABS.find(t => t.id === currentTab);
    if (!tabConfig) return;

    const list = cachedData[currentTab];
    if (!list || list.length === 0) {
        content.innerHTML = `
            <div class="lb-empty-state">
                <div class="lb-empty-icon">${currentTab === 'gifter' ? '🎁' : currentTab === 'robber' ? '🔪' : '🤡'}</div>
                <div class="lb-empty-text">${tabConfig.emptyHint}</div>
            </div>
        `;
        return;
    }

    const rankEmojis = ['🥇', '🥈', '🥉'];
    const items = list.map((entry, i) => {
        const rank = i + 1;
        const rankDisplay = rank <= 3 ? rankEmojis[i] : `${rank}.`;
        const name = entry.character_name || entry.name || `用户 ${entry.user_id.slice(-4)}`;
        const value = entry[tabConfig.valueKey] || 0;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';

        return `
            <div class="lb-rank-item ${rankClass}">
                <div class="lb-rank-num">${rankDisplay}</div>
                <div class="lb-rank-name">${escapeHtml(name)}</div>
                <div class="lb-rank-value">
                    ${value.toLocaleString()}<span class="lb-rank-unit">${tabConfig.unit}</span>
                </div>
            </div>
        `;
    }).join('');

    const bannerTitles = {
        gifter: '🎁 最慷慨的角色主人',
        robber: '🔪 恶名昭著土匪榜',
        unlucky: '🤡 倒楣蛋排行榜',
    };

    content.innerHTML = `
        <div class="lb-banner">
            <div class="lb-banner-title">${bannerTitles[currentTab]}</div>
            Top ${list.length}
        </div>
        <div class="lb-rank-list">${items}</div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════

function bindTabEvents() {
    const tabContainer = document.getElementById('lb_tabs');
    if (!tabContainer) return;

    tabContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.lb-tab');
        if (!tab) return;

        const tabId = tab.dataset.tab;
        if (tabId === currentTab) return;

        // Update active state
        tabContainer.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        currentTab = tabId;

        // If we have cached data, just re-render; otherwise fetch
        if (cachedData) {
            renderTab();
        } else {
            fetchLeaderboard();
        }
    });
}

// ── Helper ──
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
