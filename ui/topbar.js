// scripts/extensions/third-party/TheGhostFace/ui/topbar.js
import { extension_settings } from "../../../../extensions.js";

export const extensionName = "TheGhostFace";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
// CONTENT_ID defined above

function bindDrawerHandlers() {
  const $toggle = jQuery('#ghostface_main_drawer .drawer-toggle');
  const $icon = jQuery('#ghostface_drawer_icon');
  if ($toggle.length === 0) return;

  // 清除旧事件，避免重复绑定
  $toggle.off('.ghostface');
  $icon.off('.ghostface');

  const handleToggle = function (event) {
    const e = event || window.event;
    if (e?.type === 'keydown' && e.key === ' ') e.preventDefault();
    e?.preventDefault?.();
    e?.stopPropagation?.();
    toggleDrawerFallback();
  };

  $toggle.on('click.ghostface', function (e) {
    handleToggle.call(this, e);
  });

  $toggle.on('keydown.ghostface', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      handleToggle.call(this, e);
    }
  });

  // 图标点击/按键同样触发，确保主题覆盖 pointer-events 时依然可用
  $icon.on('click.ghostface', function (e) {
    e.preventDefault();
    e.stopPropagation();
    handleToggle.call($toggle.get(0), e);
  });

  $icon.on('keydown.ghostface', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      handleToggle.call($toggle.get(0), e);
    }
  });

  console.log('[GhostFace UI] 顶栏: 已绑定抽屉事件');
}


const CONTENT_ID = 'ghostface_drawer_content';

const defaultSettings = {
  iconLocation: 'topbar', // 'topbar' | 'extensions'
  rememberExpand: true,
};

function ensureSettings() {
  extension_settings[extensionName] = {
    ...defaultSettings,
    ...(extension_settings[extensionName] || {}),
  };
  return extension_settings[extensionName];
}

export function injectGhostFaceCSS() {
  const id = 'ghostface-css';
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/ui/ghostpanel.css`;
    document.head.appendChild(link);
  }
}

/** 兼容旧版 ST 顶栏开合 */
function toggleDrawerFallback() {
  const $icon = jQuery('#ghostface_drawer_icon');
  const $content = jQuery('#ghostface_drawer_content');
  const $toggle = jQuery('#ghostface_main_drawer .drawer-toggle');

  // Determine direction BEFORE changing classes
  const shouldOpen = $icon.hasClass('closedIcon');

  const runSlide = (el, opening) => {
    const $el = jQuery(el);
    const done = () => $el.closest('.drawer-content').removeClass('resizing');
    if (opening) {
      $el.stop(true, true).slideDown(200, done);
    } else {
      $el.stop(true, true).slideUp(200, done);
    }
  };

  // Sync fix: if marked open but not visible, fall back to closed
  if ($icon.hasClass('openIcon') && !$content.is(':visible')) {
    $icon.removeClass('openIcon').addClass('closedIcon');
  }

  if (shouldOpen) {
    // Close other drawers by triggering their own toggle handlers
    // This keeps ST's internal drawer state in sync (prevents world book from becoming unresponsive)
    jQuery('.drawer-icon.openIcon').not($icon).not('.drawerPinnedOpen').each(function () {
      jQuery(this).closest('.drawer').find('.drawer-toggle').trigger('click');
    });

    // Open this drawer
    $icon.removeClass('closedIcon').addClass('openIcon');
    $content.removeClass('closedDrawer').addClass('openDrawer resizing');
    runSlide($content[0], true);
    $toggle.attr('aria-expanded', 'true');
  } else {
    // Close this drawer
    $icon.removeClass('openIcon').addClass('closedIcon');
    $content.addClass('resizing');
    runSlide($content[0], false);
    // Toggle classes AFTER starting slide so animation direction is correct
    setTimeout(() => $content.removeClass('openDrawer').addClass('closedDrawer'), 10);
    $toggle.attr('aria-expanded', 'false');
  }
}

function ensureDrawerSkeleton($container) {
  if ($container.length === 0) return;
  if ($container.children().length > 0) return;
  $container
    .addClass('gf-drawer-host')
    .html(`
      <div class="gf-drawer-loader" style="display:flex;align-items:center;gap:10px;padding:18px 12px;color:var(--SmartThemeBodyColor, #ccc);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:16px;"></i>
        <span style="font-size:13px;">请先打开任意一张角色卡的聊天界面，面板将自动加载</span>
      </div>
    `);
}

// 等待某个选择器或条件成立
function waitFor(selectorOrFn, { timeout = 10000, interval = 100 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const checker = () => {
      let ok = false;
      if (typeof selectorOrFn === 'string') {
        ok = !!document.querySelector(selectorOrFn);
      } else if (typeof selectorOrFn === 'function') {
        try { ok = !!selectorOrFn(); } catch (_) { ok = false; }
      }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeout) return resolve(false);
      setTimeout(checker, interval);
    };
    checker();
  });
}

export async function createGhostFaceDrawer() {
  injectGhostFaceCSS();
  const settings = ensureSettings();
  const location = settings.iconLocation || 'topbar';

  if (location === 'topbar') {
    if ($("#ghostface_main_drawer").length > 0) return;

    // 确保 jQuery、目标锚点与 ST 顶栏已出现
    await waitFor(() => window.jQuery && document.readyState !== 'loading');
    const anchorReady = await waitFor('#sys-settings-button', { timeout: 15000, interval: 150 });

    const drawerHtml = `
      <div id="ghostface_main_drawer" class="drawer gf-drawer">
        <div class="drawer-toggle" data-drawer="${CONTENT_ID}" aria-controls="${CONTENT_ID}" role="button" aria-expanded="false" tabindex="0" style="cursor: pointer;">
          <div id="ghostface_drawer_icon"
               class="drawer-icon fa-solid fa-ghost fa-fw closedIcon interactable"
               title="GhostFace 控制面板" tabindex="0"></div>
        </div>
        <div id="${CONTENT_ID}" class="drawer-content closedDrawer"></div>
      </div>
    `;

    if (anchorReady) {
      $("#sys-settings-button").after(drawerHtml);
    } else {
      // 兜底：如果找不到系统设置按钮，尽量挂到顶栏容器或文档末尾
      const $topbar = jQuery('#top-settings-holder, .top-buttons, #option-buttons, body').first();
      if ($topbar && $topbar.length) $topbar.append(drawerHtml);
      else document.body.insertAdjacentHTML('beforeend', drawerHtml);
      console.warn('[GhostFace UI] 未找到 #sys-settings-button，已使用兜底插入。');
    }

    const $contentPanel = jQuery(`#${CONTENT_ID}`);
    ensureDrawerSkeleton($contentPanel);

    // 绑定与延迟升级为官方处理器
    bindDrawerHandlers();
  } else if (location === 'extensions') {
    if ($("#extensions_settings2 #ghostface_panel_root").length > 0) return;
    const extHtml = `
      <div id="ghostface_panel_root">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fas fa-mask"></i> GhostFace 控制面板</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div id="${CONTENT_ID}" class="inline-drawer-content" style="display:none;"></div>
        </div>
      </div>
    `;
    const $frame = $(extHtml);
    $('#extensions_settings2').append($frame);

    const $contentPanel = $frame.find(`#${CONTENT_ID}`);
    ensureDrawerSkeleton($contentPanel);

    $frame.find('.inline-drawer-toggle').on('click', function () {
      const $content = $frame.find('.inline-drawer-content');
      $content.slideToggle(180);
      $(this).find('.inline-drawer-icon').toggleClass('down up');
    });
  }
}



