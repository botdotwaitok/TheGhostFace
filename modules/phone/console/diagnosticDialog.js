// modules/phone/console/diagnosticDialog.js
// Renders an in-console diagnostic page (NOT a modal) — overlays the
// .console-app container so the user stays inside the phone shell.
// Reuses the phone viewport header (no custom back btn / title), and
// intercepts the phone-native back button via the 'phone-app-back' event.

import { buildBundle, downloadAsFile } from './diagnosticExport.js';

const VIEWPORT_TITLE_ID = 'phone_app_viewport_title';

let _pageRoot = null;
let _escHandler = null;
let _backHandler = null;
let _savedTitle = null;

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

export function openDiagnosticDialog() {
    // Stale guard: if the previous _pageRoot was wiped (e.g. console app was
    // closed and re-mounted via openAppInViewport's innerHTML replace),
    // the JS reference is non-null but the DOM is gone. Reset state.
    if (_pageRoot && !document.body.contains(_pageRoot)) {
        cleanupState();
    }
    if (_pageRoot) return;

    const consoleApp = document.querySelector('.console-app');
    if (!consoleApp) {
        console.warn('[Diagnostic] .console-app container not found');
        return;
    }

    _pageRoot = document.createElement('div');
    _pageRoot.className = 'console-diag-page';
    _pageRoot.innerHTML = renderInitialView();
    consoleApp.appendChild(_pageRoot);

    _savedTitle = setViewportTitle('导出诊断包');
    bindBackIntercept();
    bindInitialEvents();

    setTimeout(() => _pageRoot?.querySelector('#diag_desc_input')?.focus(), 50);
}

function closePage() {
    if (_pageRoot && document.body.contains(_pageRoot)) {
        _pageRoot.remove();
    }
    cleanupState();
}

function cleanupState() {
    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
    }
    if (_backHandler) {
        window.removeEventListener('phone-app-back', _backHandler);
        _backHandler = null;
    }
    if (_savedTitle != null) {
        setViewportTitle(_savedTitle);
        _savedTitle = null;
    }
    _pageRoot = null;
}

// ═══════════════════════════════════════════════════════════════════════
// Viewport title swap + back-button interception
// ═══════════════════════════════════════════════════════════════════════

function setViewportTitle(text) {
    const titleEl = document.getElementById(VIEWPORT_TITLE_ID);
    if (!titleEl) return null;
    const prev = titleEl.textContent;
    titleEl.textContent = text;
    return prev;
}

function bindBackIntercept() {
    if (_backHandler) window.removeEventListener('phone-app-back', _backHandler);
    _backHandler = (e) => {
        if (_pageRoot && document.body.contains(_pageRoot)) {
            e.preventDefault();
            closePage();
        }
    };
    window.addEventListener('phone-app-back', _backHandler);
}

// ═══════════════════════════════════════════════════════════════════════
// View
// ═══════════════════════════════════════════════════════════════════════

function renderInitialView() {
    return `
    <div class="console-diag-page-body">
        <div class="diag-section">
            <div class="diag-section-title">本诊断包将包含</div>
            <ul class="diag-list">
                <li><i class="ph ph-check"></i> 插件版本、ST 版本、浏览器/屏幕信息</li>
                <li><i class="ph ph-check"></i> 当前 ST 选中的 API / 模型（仅主机名，不含密钥）</li>
                <li><i class="ph ph-check"></i> 你启用的正则脚本（名称 / 规则 / 启用状态）</li>
                <li><i class="ph ph-check"></i> 最近出现在 Console 里的错误、网络请求、模块日志</li>
            </ul>
        </div>

        <div class="diag-section diag-section-ok">
            <div class="diag-section-title">
                <i class="ph ph-shield-check"></i> 已自动脱敏
            </div>
            <div class="diag-section-text">
                日志和网络记录中检测到的 API 密钥、Bearer token、JWT，
                以及 URL 里的 <code>key=</code> / <code>token=</code> 等查询参数，
                都会被替换为 <code>***REDACTED***</code>。
            </div>
        </div>

        <div class="diag-section diag-section-warn">
            <div class="diag-section-title">
                <i class="ph ph-warning"></i> 请注意
            </div>
            <div class="diag-section-text">
                下载完成后，<strong>请先用记事本打开检查内容</strong>。
                如果有不希望分享的私人信息（角色名、聊天片段等），
                可以直接在文件里编辑删除后再发送。
            </div>
        </div>

        <div class="diag-section">
            <label class="diag-section-title" for="diag_desc_input">
                <i class="ph ph-pencil-simple"></i> 简单描述你遇到的问题（可选但很有用）
            </label>
            <textarea id="diag_desc_input" class="diag-input" rows="3"
                placeholder="比如：发朋友圈一直转圈不出结果 / 聊天消息显示空白"></textarea>
        </div>
    </div>

    <div class="console-diag-page-footer">
        <button class="diag-btn diag-btn-primary" id="diag_download_btn">
            <i class="ph ph-download-simple"></i>
            <span>下载诊断包</span>
        </button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════

function bindInitialEvents() {
    if (!_pageRoot) return;
    _pageRoot.querySelector('#diag_download_btn')?.addEventListener('click', handleDownloadClick);
    bindEscape();
}

function bindEscape() {
    if (_escHandler) document.removeEventListener('keydown', _escHandler);
    _escHandler = (e) => {
        if (e.key === 'Escape') closePage();
    };
    document.addEventListener('keydown', _escHandler);
}

function handleDownloadClick() {
    if (!_pageRoot) return;

    const descInput = _pageRoot.querySelector('#diag_desc_input');
    const userDescription = (descInput?.value || '').trim();
    const downloadBtn = _pageRoot.querySelector('#diag_download_btn');

    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> <span>打包中...</span>';
    }

    try {
        const bundle = buildBundle({ userDescription });
        const result = downloadAsFile(bundle);

        if (result.success) {
            showSuccessToast();
            closePage();
        } else {
            throw new Error(result.error || '下载失败');
        }
    } catch (err) {
        console.error('[Diagnostic] export failed:', err);
        if (typeof toastr !== 'undefined') {
            toastr.error('导出失败：' + (err?.message || String(err)));
        }
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="ph ph-download-simple"></i> <span>下载诊断包</span>';
        }
    }
}

function showSuccessToast() {
    if (typeof toastr === 'undefined') return;
    toastr.success(
        '请用记事本打开检查内容，再发送',
        '诊断包已下载',
        { timeOut: 7000, extendedTimeOut: 3000 }
    );
}
