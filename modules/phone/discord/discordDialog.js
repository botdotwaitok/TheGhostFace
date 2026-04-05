import { escapeHtml } from '../utils/helpers.js';

/**
 * Unified Discord Community App Dialog System.
 * Ensures dialogs are mounted at the highest unscrollable level (`#phone_app_viewport`)
 * to avoid the "Overlay-inside-Scrollable" pitfall.
 * 
 * @param {Object} options
 * @param {string} options.title - Title text or HTML (e.g. includes an icon)
 * @param {string} options.contentHtml - The HTML content for the dialog body
 * @param {Function} [options.onRender] - (overlayElement) => void. Called after mount to bind events.
 * @param {Function} [options.onSave] - (closeFunc) => void. Called when Save is clicked.
 * @param {Function} [options.onCancel] - (closeFunc) => void. Called when Cancel is clicked or background is tapped.
 * @param {string} [options.saveText='保存'] - Text for the primary save button.
 * @param {string} [options.cancelText='取消'] - Text for the secondary cancel button.
 */
export function showDiscordDialog(options) {
    const {
        title = '提示',
        contentHtml = '',
        saveText = '保存',
        cancelText = '取消',
        onSave = null,
        onCancel = null,
        onRender = null
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'dc-dialog-overlay dc-fade-in';
    
    // We use isolated IDs or classes within the dialog if we want, but generating unique IDs is safer if multiple could open.
    // However, usually only one dialog is open at a time.
    const _baseId = 'dc_dialog_' + Date.now() + Math.floor(Math.random()*1000);
    const cancelBtn = overlay.querySelector('.dc-btn-secondary');
    const saveBtn = overlay.querySelector('.dc-btn-primary');

    overlay.innerHTML = `
        <div class="dc-dialog" style="max-height: 85vh; display: flex; flex-direction: column;">
            <div class="dc-dialog-title">${title}</div>
            <div class="dc-dialog-body" style="padding-top: 12px; overflow-y: auto; flex-shrink: 1; scrollbar-width: thin;">
                ${contentHtml}
            </div>
            <div class="dc-dialog-actions" style="margin-top: 16px; flex-shrink: 0;">
                <button class="dc-btn dc-btn-secondary dc-btn-sm">${cancelText}</button>
                <button class="dc-btn dc-btn-primary dc-btn-sm">${saveText}</button>
            </div>
        </div>
    `;

    // Mount to the viewport to avoid being trapped in scrollable containers
    const mountTarget = document.getElementById('phone_app_viewport') || document.body;
    mountTarget.appendChild(overlay);

    const closeDialog = () => {
        overlay.classList.remove('dc-fade-in');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
    };

    // Cancel / Close
    const handleCancel = () => {
        if (onCancel) onCancel(closeDialog);
        else closeDialog();
    };

    overlay.querySelector('.dc-btn-secondary')?.addEventListener('click', handleCancel);

    // Clicking overlay background closes
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            handleCancel();
        }
    });

    // Save Action
    overlay.querySelector('.dc-btn-primary')?.addEventListener('click', () => {
        if (onSave) onSave(closeDialog);
        else closeDialog();
    });

    // User callback to bind inner events
    if (onRender) {
        onRender(overlay);
    }
}

/**
 * Helper: A simple prompt dialog with one text input.
 * Replaces browser `prompt()`.
 */
export function showDiscordPrompt({ title, placeholder = '', defaultValue = '', note = '', onConfirm }) {
    const inputId = 'dc_prompt_' + Date.now();
    const noteHtml = note ? `<div class="dc-form-note"><i class="ph ph-info"></i> ${escapeHtml(note)}</div>` : '';
    
    showDiscordDialog({
        title,
        contentHtml: `
            <div class="dc-form-section" style="margin-bottom:0;">
                <input type="text" class="dc-input" id="${inputId}" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" maxlength="50" autocomplete="off" />
                ${noteHtml}
            </div>
        `,
        onRender: (overlay) => {
            const input = overlay.querySelector(`#${inputId}`);
            if (input) {
                // Auto focus and move cursor to end
                setTimeout(() => {
                    input.focus();
                    if (input.value) {
                        input.setSelectionRange(input.value.length, input.value.length);
                    }
                }, 100);
                
                // Allow enter key to submit
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const saveBtn = overlay.querySelector('.dc-btn-primary');
                        if(saveBtn) saveBtn.click();
                    }
                });
            }
        },
        onSave: (close) => {
            const val = document.getElementById(inputId)?.value?.trim() || '';
            // If onConfirm returns false explicitly, do not close (e.g. for validation failure)
            if (onConfirm(val, close) !== false) {
                close();
            }
        }
    });
}
