import * as manager from '../modules/worldbookManager.js';
import * as utils from '../modules/utils.js';

const POS_MAP = {
    0: "Before Char",
    1: "After Char",
    2: "Before EM",
    3: "After EM",
    4: "Depth"
};

export async function renderWorldbookManagerPanel() {
    const container = document.getElementById('ghostface_worldbook_manager_content');
    if (!container) return;

    container.innerHTML = '<div class="ghost-loading">加载世界书条目...</div>';

    try {
        const { activeBooks, entries, totalEntries } = await manager.fetchWorldbookEntriesDashboardData();

        if (totalEntries === 0) {
            container.innerHTML = '<div class="ghost-empty-state">未找到激活的世界书或条目。</div>';
            return;
        }

        // Group entries by position
        const groupedEntries = {};
        Object.keys(POS_MAP).forEach(k => groupedEntries[k] = []);
        entries.forEach(entry => {
            const pos = (entry.position !== undefined) ? Number(entry.position) : 1;
            if (!groupedEntries[pos]) groupedEntries[pos] = [];
            groupedEntries[pos].push(entry);
        });

        let html = `
            <div class="wb-manager-header">
                <h3>已激活世界书 (${activeBooks.length})</h3>
                <div class="wb-list-tags">
                    ${activeBooks.map(book => `<span class="wb-tag">${utils.escapeHtml(book)}</span>`).join('')}
                </div>
            </div>
            <div class="wb-entries-list">
                <h4>条目总计 (${totalEntries})</h4>
                <div class="wb-entries-container">
        `;

        // Render each group
        for (const [posKey, label] of Object.entries(POS_MAP)) {
            const groupList = groupedEntries[posKey] || [];
            if (groupList.length === 0) continue;

            // Calculate available orders for this specific position group
            const availableOrders = manager.findAvailableOrders(groupList, 0, 500).slice(0, 30);

            html += `
                <div class="wb-group-section">
                    <h5 class="wb-group-title" data-pos="${posKey}">
                        <span class="wb-group-icon">▶</span> ${label} (${groupList.length})
                    </h5>
                    <div class="wb-group-content" style="display: none;">
                        <div class="wb-orders-overview">
                            <span class="wb-orders-label">可用插入顺序 (${label}):</span>
                            <span class="wb-available-orders">${availableOrders.join(', ')}</span>
                        </div>
            `;

            groupList.forEach(entry => {
                const order = entry.order ?? 100;
                const pos = entry.position ?? 1;
                const depth = entry.depth ?? 4;
                const isActive = !entry.disable;
                const keywords = Array.isArray(entry.key) ? entry.key.join(', ') : (entry.key || '');
                const uid = entry.uid;
                const source = entry.sourceWorldBook;

                html += `
                    <div class="wb-entry-card" title="Source: ${utils.escapeHtml(source)}">
                        <div class="wb-entry-header">
                            <span class="wb-entry-source">[${utils.escapeHtml(source)}]</span>
                            <span class="wb-entry-keys">${utils.escapeHtml(keywords || 'No Keys')}</span>
                        </div>
                        <div class="wb-entry-comment">${utils.escapeHtml(entry.comment || 'No Comment')}</div>
                        
                        <div class="wb-entry-edit-row">
                            <label class="ghost-toggle-row wb-edit-toggle-row" style="margin-bottom: 0;">
                                <span class="ghost-toggle-label" style="font-size: 14px;">Active</span>
                                <div class="ghost-toggle-switch">
                                    <input type="checkbox" class="wb-edit-active" data-uid="${uid}" data-source="${utils.escapeHtml(source)}" ${isActive ? 'checked' : ''}>
                                    <span class="ghost-toggle-slider"></span>
                                </div>
                            </label>

                            <label class="ghost-toggle-row wb-edit-toggle-row" style="margin-bottom: 0;" title="Normal/Keyword (Green) or Constant/Always-injected (Blue)">
                                <span class="ghost-toggle-label" style="font-size: 14px;">Type</span>
                                <div class="ghost-toggle-switch wb-type-switch">
                                    <input type="checkbox" class="wb-edit-constant" data-uid="${uid}" data-source="${utils.escapeHtml(source)}" ${entry.constant ? 'checked' : ''}>
                                    <span class="ghost-toggle-slider"></span>
                                </div>
                            </label>

                            <label class="wb-edit-label" style="margin-left: 8px;">
                                Pos:
                                <select class="wb-edit-pos ghost-select" data-uid="${uid}" data-source="${utils.escapeHtml(source)}">
                                    ${Object.entries(POS_MAP).map(([k, v]) => `<option value="${k}" ${k == pos ? 'selected' : ''}>${v}</option>`).join('')}
                                </select>
                            </label>

                            <label class="wb-edit-label" style="${pos == 4 ? '' : 'opacity: 0.5; pointer-events: none;'}">
                                Depth:
                                <input type="number" class="wb-edit-depth ghost-input" value="${depth}" min="0" max="99" data-uid="${uid}" data-source="${utils.escapeHtml(source)}">
                            </label>

                            <label class="wb-edit-label">
                                Order:
                                <input type="number" class="wb-edit-order ghost-input" value="${order}" min="0" max="1000" data-uid="${uid}" data-source="${utils.escapeHtml(source)}">
                            </label>
                            
                            <button class="ghost-button wb-save-btn" data-uid="${uid}" data-source="${utils.escapeHtml(source)}">Save</button>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;

    } catch (error) {
        utils.logger.error('Failed to render Worldbook Manager panel:', error);
        container.innerHTML = '<div class="ghost-error">Error loading worldbook data. See console for details.</div>';
    }
}

export function setupWorldbookManagerEvents() {
    const refreshBtn = document.getElementById('wb_manager_refresh_btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            renderWorldbookManagerPanel();
            utils.logger.info("Worldbook manager refreshed.");
        });
    }

    // Attach listener when panel is opened via tab
    const wbTabBtn = document.getElementById('gf_tab_worldbook_manager');
    if (wbTabBtn) {
        wbTabBtn.addEventListener('click', () => {
            setTimeout(renderWorldbookManagerPanel, 100);
        });
    }

    // Dynamic events for the container
    const container = document.getElementById('ghostface_worldbook_manager_content');
    if (container && !container.dataset.eventsBound) {
        container.dataset.eventsBound = "true";

        container.addEventListener('click', async (e) => {
            // Accordion toggle
            const groupTitle = e.target.closest('.wb-group-title');
            if (groupTitle) {
                const groupContent = groupTitle.nextElementSibling;
                const icon = groupTitle.querySelector('.wb-group-icon');
                if (groupContent.style.display === 'none') {
                    groupContent.style.display = 'block';
                    if (icon) icon.textContent = '▼';
                } else {
                    groupContent.style.display = 'none';
                    if (icon) icon.textContent = '▶';
                }
                return;
            }

            // Save button
            if (e.target.classList.contains('wb-save-btn')) {
                const btn = e.target;
                const uid = btn.dataset.uid;
                const source = btn.dataset.source;
                const card = btn.closest('.wb-entry-card');

                if (!uid || !source || !card) return;

                const activeCheckbox = card.querySelector('.wb-edit-active');
                const constantCheckbox = card.querySelector('.wb-edit-constant');
                const posSelect = card.querySelector('.wb-edit-pos');
                const depthInput = card.querySelector('.wb-edit-depth');
                const orderInput = card.querySelector('.wb-edit-order');

                const updates = {
                    disable: !activeCheckbox.checked,
                    constant: constantCheckbox.checked,
                    position: parseInt(posSelect.value),
                    depth: parseInt(depthInput.value) || 4,
                    order: parseInt(orderInput.value) || 100
                };

                btn.textContent = 'Saving...';
                btn.disabled = true;

                try {
                    await manager.updateEntryProperties(source, uid, updates);
                    btn.textContent = 'Saved!';
                    btn.classList.add('ghost-success-btn');
                    setTimeout(() => {
                        btn.textContent = 'Save';
                        btn.classList.remove('ghost-success-btn');
                        btn.disabled = false;

                        // Optionally refresh the panel to re-sort if order/pos changed
                        // Currently we don't automatically refresh to prevent losing UI state (accordion expanded).
                        // Instead, we just keep it saved.
                    }, 1500);
                } catch (err) {
                    btn.textContent = 'Error';
                    setTimeout(() => {
                        btn.textContent = 'Save';
                        btn.disabled = false;
                    }, 2000);
                }
            }
        });

        // Change event for position select (to toggle depth visibility)
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('wb-edit-pos')) {
                const posSelect = e.target;
                const card = posSelect.closest('.wb-entry-card');
                if (!card) return;

                const depthInput = card.querySelector('.wb-edit-depth');
                const depthContainer = depthInput.closest('.wb-edit-label');

                if (posSelect.value == '4') {
                    depthContainer.style.opacity = '1';
                    depthContainer.style.pointerEvents = 'auto';
                } else {
                    depthContainer.style.opacity = '0.5';
                    depthContainer.style.pointerEvents = 'none';
                }
            }
        });
    }
}
