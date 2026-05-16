// modules/worldbook/worldbookApp.js — Standalone editor launcher.
// Opens the worldbook editor in a new browser tab and pushes the init
// package via BroadcastChannel. Same-origin tabs can talk through the
// shared channel just like sibling popups.

import { pushInitPackage } from './worldbookBridge.js';

const LOG = '[WorldBook App]';

let _editorWindow = null;

export function openWorldbookEditor() {
    if (_editorWindow && !_editorWindow.closed) {
        _editorWindow.focus();
        pushInitPackage();
        return;
    }

    const scriptUrl = import.meta.url;
    const baseDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/'));
    const htmlUrl = `${baseDir}/worldbook-standalone.html`;

    // Omitting the features arg makes the browser open a tab instead of a popup.
    // The named target ('gf-worldbook') ensures repeated clicks reuse the same tab.
    _editorWindow = window.open(htmlUrl, 'gf-worldbook');

    if (!_editorWindow) {
        console.error(`${LOG} window.open() blocked by browser.`);
        if (typeof toastr !== 'undefined') {
            toastr.warning('浏览器拦截了新标签页，请允许本站打开新窗口/标签页后重试');
        }
        return;
    }

    console.log(`${LOG} Editor tab opened`);

    // Push init after the tab has a chance to subscribe to the channel.
    setTimeout(() => pushInitPackage(), 500);
    setTimeout(() => {
        if (_editorWindow && !_editorWindow.closed) pushInitPackage();
    }, 2000);
}
