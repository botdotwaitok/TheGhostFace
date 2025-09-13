// scripts/extensions/third-party/TheGhostFace/ui/topbar.js
import { getSlideToggleOptions } from '/script.js';
import { slideToggle } from '/lib.js';
import { extension_settings } from "/scripts/extensions.js";

// ★与你扩展名一致
export const extensionName = "TheGhostFace";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

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
    link.href = `${extensionFolderPath}/assets/ghostface.css`;
    document.head.appendChild(link);
  }
}

/** 允许把你现有UI挂载到容器里（如果你已有 createGhostControlPanel，可在此调用） */
// 把已有的旧面板 DOM 直接装进抽屉容器
async function mountGhostFaceUI($container) {
  const $legacyRoot = $('#the_ghost_face_control_panel');
  if ($legacyRoot.length) {
    $legacyRoot.detach().show().addClass('gf-legacy-mounted');
    $container.empty().append($legacyRoot);
    return;
  }
}


/** 兼容旧版 ST 顶栏开合 */
function toggleDrawerFallback() {
  const drawerIcon = $('#ghostface_drawer_icon');
  const $contentPanel = $('#ghostface_drawer_content');

  if (drawerIcon.hasClass('openIcon') && !$contentPanel.is(':visible')) {
    drawerIcon.removeClass('openIcon').addClass('closedIcon');
  }

  if (drawerIcon.hasClass('closedIcon')) {
    $('.openDrawer').not($contentPanel).not('.pinnedOpen')
      .addClass('resizing').each((_, el) => {
        slideToggle(el, {
          ...getSlideToggleOptions(),
          onAnimationEnd: function (el2) {
            el2.closest('.drawer-content').classList.remove('resizing');
          },
        });
      });
    $('.openIcon').not(drawerIcon).not('.drawerPinnedOpen').toggleClass('closedIcon openIcon');
    $('.openDrawer').not($contentPanel).not('.pinnedOpen').toggleClass('closedDrawer openDrawer');

    drawerIcon.toggleClass('closedIcon openIcon');
    $contentPanel.toggleClass('closedDrawer openDrawer');

    $contentPanel.addClass('resizing').each((_, el) => {
      slideToggle(el, {
        ...getSlideToggleOptions(),
        onAnimationEnd: function (el2) {
          el2.closest('.drawer-content').classList.remove('resizing');
        },
      });
    });
  } else {
    drawerIcon.toggleClass('openIcon closedIcon');
    $contentPanel.toggleClass('openDrawer closedDrawer');

    $contentPanel.addClass('resizing').each((_, el) => {
      slideToggle(el, {
        ...getSlideToggleOptions(),
        onAnimationEnd: function (el2) {
          el2.closest('.drawer-content').classList.remove('resizing');
        },
      });
    });
  }
}

export async function createGhostFaceDrawer() {
  const settings = ensureSettings();
  const location = settings.iconLocation || 'topbar';

  if (location === 'topbar') {
    if ($("#ghostface_main_drawer").length > 0) return;

    const drawerHtml = `
      <div id="ghostface_main_drawer" class="drawer gf-drawer">
        <div class="drawer-toggle" data-drawer="ghostface_drawer_content">
          <div id="ghostface_drawer_icon"
               class="drawer-icon fa-solid fa-ghost fa-fw closedIcon interactable"
               title="GhostFace 控制面板" tabindex="0"></div>
        </div>
        <div id="ghostface_drawer_content" class="drawer-content closedDrawer"></div>
      </div>
    `;
    

    // 挂到系统设置按钮后
    $("#sys-settings-button").after(drawerHtml);

    const $contentPanel = $("#ghostface_drawer_content");
    await mountGhostFaceUI($contentPanel);

    try {
      const { doNavbarIconClick } = await import('/script.js');
      if (typeof doNavbarIconClick === 'function') {
        $('#ghostface_main_drawer .drawer-toggle').on('click', doNavbarIconClick);
        console.log('[GhostFace UI] 使用 doNavbarIconClick。');
      } else {
        throw new Error('doNavbarIconClick missing');
      }
    } catch {
      $('#ghostface_main_drawer .drawer-toggle').on('click', toggleDrawerFallback);
      console.log('[GhostFace UI] 旧版 ST：使用 fallback 切换。');
    }
  } else if (location === 'extensions') {
    if ($("#extensions_settings2 #ghostface_panel_root").length > 0) return;
    const extHtml = `
      <div id="ghostface_panel_root">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fas fa-mask"></i> GhostFace 控制面板</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content" style="display:none;"></div>
        </div>
      </div>
    `;
    const $frame = $(extHtml);
    $('#extensions_settings2').append($frame);

    const $contentPanel = $frame.find('.inline-drawer-content');
    await mountGhostFaceUI($contentPanel);

    $frame.find('.inline-drawer-toggle').on('click', function () {
      const $content = $frame.find('.inline-drawer-content');
      $content.slideToggle(180);
      $(this).find('.inline-drawer-icon').toggleClass('down up');
    });
  }
  // 抽屉结构插入到 DOM 之后：
await waitAndMountLegacyPanel();

}

async function waitAndMountLegacyPanel() {
  const $container = $('#ghostface_drawer_content');
  if ($container.length === 0) return;

  // 已经搬过就别重复
  if ($container.find('#the_ghost_face_control_panel').length > 0) return;

  // 等待旧UI被 ui.js 加载（最多等 5 秒，每 100ms 检查一次）
  let tries = 0;
  const maxTries = 50;
  const timer = setInterval(() => {
    const $legacy = $('#the_ghost_face_control_panel');
    if ($legacy.length) {
      clearInterval(timer);
      $legacy.detach().show().addClass('gf-legacy-mounted').appendTo($container);
      console.log('[GhostFace] legacy panel mounted into topbar drawer.');
    } else if (++tries >= maxTries) {
      clearInterval(timer);
      console.warn('[GhostFace] legacy panel not found in time.');
    }
  }, 100);
}
