// modules/phone/handbook/handbookApp.js — Phone Shell Launcher
// Registers the Handbook app icon on the phone home screen.
// On click, opens the standalone handbook window via window.open()
// and pushes the init package via BroadcastChannel.

import { pushInitPackage } from './handbookBridge.js';
import { getPhoneSetting, setPhoneSetting } from '../phoneSettings.js';

const LOG = '[HandBook App]';

// ═══════════════════════════════════════════════════════════════════════
// Feature Gate
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if the handbook feature is enabled.
 * Default: false (user must enable in Settings)
 */
export function isHandbookEnabled() {
    return getPhoneSetting('handbookEnabled', false);
}

/**
 * Set the handbook feature enabled/disabled.
 */
export function setHandbookEnabled(enabled) {
    setPhoneSetting('handbookEnabled', enabled);
}

// ═══════════════════════════════════════════════════════════════════════
// App Launcher
// ═══════════════════════════════════════════════════════════════════════

let _handbookWindow = null;

/**
 * Open the handbook in a standalone browser window.
 * Also pushes the settings package via BroadcastChannel.
 */
export function openHandbookApp() {
    // Check if already open and not closed
    if (_handbookWindow && !_handbookWindow.closed) {
        _handbookWindow.focus();
        // Re-push init package in case credentials changed
        pushInitPackage();
        return;
    }

    // Compute the URL for the standalone HTML
    // The HTML file is co-located with this JS file in modules/phone/handbook/
    const scriptUrl = import.meta.url;
    const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
    const htmlUrl = `${baseDir}/handbook-standalone.html`;

    // Open standalone window
    const width = 700;
    const height = 900;
    const left = Math.max(0, Math.round((screen.width - width) / 2));
    const top = Math.max(0, Math.round((screen.height - height) / 2));

    _handbookWindow = window.open(
        htmlUrl,
        'gf-handbook',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    );

    if (!_handbookWindow) {
        console.error(`${LOG} window.open() blocked by browser. Please allow popups.`);
        if (typeof toastr !== 'undefined') {
            toastr.warning('浏览器拦截了弹窗，请允许本站弹窗后重试');
        }
        return;
    }

    console.log(`${LOG} Standalone window opened`);

    // Push init package after a small delay (let the window load)
    setTimeout(() => {
        pushInitPackage();
    }, 500);

    // Also push again after a longer delay for slow loads
    setTimeout(() => {
        if (_handbookWindow && !_handbookWindow.closed) {
            pushInitPackage();
        }
    }, 2000);
}
