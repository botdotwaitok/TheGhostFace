// Plugin update check.
// Talks to ST's built-in /api/extensions/version endpoint to find out whether
// the local clone is behind the remote HEAD. When it is, also fetch the local
// and remote manifest.json to show "current vN -> latest vM" in the banner.
// Result is cached in localStorage to throttle the check to once per day.

import { getRequestHeaders } from '../../../../../script.js';
import { extensionTypes } from '../../../../extensions.js';

const EXTENSION_NAME = '/TheGhostFace';
const STORAGE_KEY = 'ghostface_update_nag_v1';
const BANNER_ID = 'ghostface_update_banner';

// Mirror ST's logic: extensionTypes is keyed by `third-party/<folder>`. The
// stored value ('global' | 'local' | 'system') tells the /version endpoint
// which base directory to look in. Defaulting to 'global' matches the install
// shipped in public/scripts/extensions/third-party/.
function isGlobalInstall() {
    const trimmed = EXTENSION_NAME.replace(/^\//, '');
    const key = Object.keys(extensionTypes).find(k =>
        k === EXTENSION_NAME || k === `third-party/${trimmed}`,
    );
    if (!key) return true;
    return extensionTypes[key] === 'global';
}

function readCache() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return data;
    } catch {
        return null;
    }
}

function writeCache(patch) {
    try {
        const prev = readCache() || {};
        const next = { ...prev, ...patch };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // localStorage unavailable — silently degrade
    }
}

function todayKey() {
    return new Date().toDateString();
}

async function fetchStVersion() {
    try {
        const resp = await fetch('/api/extensions/version', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                extensionName: EXTENSION_NAME,
                global: isGlobalInstall(),
            }),
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        console.warn('[GhostFace] update version fetch failed:', e);
        return null;
    }
}

async function fetchLocalVersion() {
    try {
        const url = new URL('../manifest.json', import.meta.url).href;
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) return null;
        const data = await resp.json();
        return typeof data?.version === 'string' ? data.version : null;
    } catch {
        return null;
    }
}

// Parse a git remote URL into { owner, repo }. Handles HTTPS and SSH forms,
// trailing .git, and trailing slash.
function parseGithubRepo(remoteUrl) {
    if (!remoteUrl || typeof remoteUrl !== 'string') return null;
    const cleaned = remoteUrl.replace(/\.git\/?$/, '').replace(/\/$/, '');
    const m = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
}

async function fetchRemoteVersion(remoteUrl, branchName) {
    const parsed = parseGithubRepo(remoteUrl);
    if (!parsed) return null;
    const branch = branchName || 'main';
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/manifest.json`;
    try {
        const resp = await fetch(rawUrl, { cache: 'no-cache' });
        if (!resp.ok) return null;
        const data = await resp.json();
        return typeof data?.version === 'string' ? data.version : null;
    } catch {
        return null;
    }
}

function bindDismiss(banner) {
    const dismissEl = banner.querySelector('[data-action="dismiss"]');
    if (!dismissEl || dismissEl.dataset.bound) return;
    dismissEl.dataset.bound = '1';
    dismissEl.addEventListener('click', () => {
        banner.style.display = 'none';
        writeCache({ dismissedDate: todayKey() });
    });
}

function showBanner(currentVersion, remoteVersion) {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) return false;

    const currentEl = banner.querySelector('[data-slot="current-version"]');
    const latestEl = banner.querySelector('[data-slot="latest-version"]');
    if (currentEl) currentEl.textContent = currentVersion ? `v${currentVersion}` : '当前版本未知';
    if (latestEl) latestEl.textContent = remoteVersion ? `v${remoteVersion}` : '新版本可用';

    bindDismiss(banner);
    banner.style.display = 'flex';
    return true;
}

// Retry placing the banner in case the panel template hasn't been mounted yet.
function showBannerWhenReady(currentVersion, remoteVersion, attempt = 0) {
    if (showBanner(currentVersion, remoteVersion)) return;
    if (attempt >= 20) return;
    setTimeout(() => showBannerWhenReady(currentVersion, remoteVersion, attempt + 1), 500);
}

export async function initUpdateCheck() {
    const cache = readCache();
    const today = todayKey();

    // Dismissed today — silent until tomorrow.
    if (cache && cache.dismissedDate === today) return;

    // Already checked today — render banner from cache, no network calls.
    if (cache && cache.checkedDate === today) {
        if (cache.hasUpdate) {
            showBannerWhenReady(cache.currentVersion, cache.remoteVersion);
        }
        return;
    }

    // Stale or missing — query the server.
    const stData = await fetchStVersion();
    if (!stData) return;

    const hasUpdate = stData.isUpToDate === false;

    let currentVersion = null;
    let remoteVersion = null;
    if (hasUpdate) {
        [currentVersion, remoteVersion] = await Promise.all([
            fetchLocalVersion(),
            fetchRemoteVersion(stData.remoteUrl, stData.currentBranchName),
        ]);
    }

    writeCache({
        checkedDate: today,
        hasUpdate,
        currentVersion,
        remoteVersion,
        currentCommitHash: stData.currentCommitHash || null,
    });

    if (hasUpdate) {
        showBannerWhenReady(currentVersion, remoteVersion);
    }
}
