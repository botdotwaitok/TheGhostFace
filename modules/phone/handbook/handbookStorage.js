// modules/phone/handbook/handbookStorage.js — ST File System Storage Layer
// Uploads/reads Canvas WebP images and metadata JSON via ST's /api/files/upload endpoint.
// Reference: TheSingularity/index.js uploadToSillyTavern() pattern.
// NOTE: ST file API rejects '/' in filenames, so we use flat naming: hb_charId_filename

const LOG = '[HandBook Storage]';
const HB_PREFIX = 'hb';

// ═══════════════════════════════════════════════════════════════════════
// Upload — Push files to ST server
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a Blob (WebP image or JSON) to the ST file system.
 * @param {Blob} blob - The file data
 * @param {string} filename - Target filename (flat, no slashes, e.g. 'hb_mychar_page_001.webp')
 * @param {object} stHeaders - ST request headers (from getRequestHeaders())
 * @returns {Promise<string>} The server path of the uploaded file
 */
export async function uploadHandbookFile(blob, filename, stHeaders) {
    if (!blob || blob.size === 0) throw new Error(`${LOG} Empty blob for ${filename}`);
    const base64Data = await blobToBase64(blob);

    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...stHeaders,
        },
        body: JSON.stringify({ name: filename, data: base64Data }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${LOG} Upload failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const rawPath = result.path || `user/files/${filename}`;
    const webPath = rawPath.replace(/\\/g, '/');
    console.log(`${LOG} Uploaded: ${webPath}`);
    return webPath;
}

/**
 * Upload a Canvas data URL as a WebP file.
 */
export async function uploadCanvasPage(canvasDataUrl, charId, pageId, stHeaders) {
    const blob = dataUrlToBlob(canvasDataUrl);
    const filename = `${HB_PREFIX}_${charId}_${pageId}.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Upload a response JSON file.
 */
export async function uploadResponseData(responseData, charId, pageId, stHeaders) {
    const json = JSON.stringify(responseData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `${HB_PREFIX}_${charId}_resp_${pageId}.json`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Save handbook metadata (meta.json).
 */
export async function saveHandbookMeta(meta, charId, stHeaders) {
    const json = JSON.stringify(meta, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const filename = `${HB_PREFIX}_${charId}_meta.json`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

// ═══════════════════════════════════════════════════════════════════════
// Read — Fetch files from ST server
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load handbook metadata for a character.
 */
export async function loadHandbookMeta(charId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_meta.json`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`${LOG} loadMeta failed: ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        console.warn(`${LOG} loadHandbookMeta:`, e);
        return null;
    }
}

/**
 * Load a single page's canvas image as a data URL.
 */
export async function loadHandbookPage(charId, pageId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_${pageId}.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return await blobToDataUrl(blob);
    } catch (e) {
        console.warn(`${LOG} loadHandbookPage:`, e);
        return null;
    }
}

/**
 * Load a page's response data.
 */
export async function loadHandbookResponse(charId, pageId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_resp_${pageId}.json`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.warn(`${LOG} loadHandbookResponse:`, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Meta Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create an empty meta.json structure.
 * Outputs v4 format directly (texts[], color) — no migration needed.
 */
export function createEmptyMeta(charId, charName, userName) {
    return {
        version: 2,
        charId,
        charName,
        userName,
        createdAt: new Date().toISOString().split('T')[0],
        nextPageCounter: 0,     // Monotonic page counter for unique IDs
        cover: {
            type: 'color',
            color: '#2c3e50',
            texts: [],
            _saved: false,
        },
        flyleaf: {
            ownerName: '',
            charMessage: '',
        },
        pages: [],
        stickers: [],
        tapes: [],
        settings: {
            userInkColor: '#2c3e50',
            charInkColor: '#e74c6a',
            charFont: "'Caveat', cursive",
            pagePattern: 'dots',
            pageColor: '#fefcf7',
            patternStyle: {
                color: '#b4aa96',
                opacity: 0.4,
                size: 1.5,
                spacing: 20,
            },
            recentColors: [],
        },
        customBackgrounds: [],
    };
}

/**
 * Generate next unique page ID using a monotonic counter.
 * Never collides even after page deletions.
 * @param {object} meta
 * @returns {string} e.g. 'page_003'
 */
export function nextPageId(meta) {
    if (typeof meta.nextPageCounter !== 'number') {
        // Migrate: set counter to highest existing page number + 1
        let max = 0;
        for (const p of (meta.pages || [])) {
            const m = p.id?.match(/page_(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1]));
        }
        meta.nextPageCounter = max;
    }
    meta.nextPageCounter++;
    return `page_${String(meta.nextPageCounter).padStart(3, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Cover & Flyleaf
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a cover image file.
 */
export async function uploadCoverImage(fileOrDataUrl, charId, stHeaders) {
    let blob;
    if (typeof fileOrDataUrl === 'string') {
        blob = dataUrlToBlob(fileOrDataUrl);
    } else {
        blob = fileOrDataUrl;
    }
    blob = await convertToWebP(blob, 0.9);
    const filename = `${HB_PREFIX}_${charId}_cover.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Load cover image as an object URL.
 */
export async function loadCoverImage(charId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_cover.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn(`${LOG} loadCoverImage:`, e);
        return null;
    }
}

/**
 * Upload a flyleaf canvas as WebP.
 */
export async function uploadFlyleafCanvas(canvasDataUrl, charId, stHeaders) {
    const blob = dataUrlToBlob(canvasDataUrl);
    const filename = `${HB_PREFIX}_${charId}_flyleaf.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Load flyleaf canvas data URL.
 */
export async function loadFlyleafCanvas(charId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_flyleaf.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return await blobToDataUrl(blob);
    } catch (e) {
        console.warn(`${LOG} loadFlyleafCanvas:`, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Custom Background
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a custom page background image.
 */
export async function uploadCustomBg(file, charId, bgId, stHeaders) {
    let blob;
    if (file instanceof Blob) {
        blob = file;
    } else if (typeof file === 'string') {
        blob = dataUrlToBlob(file);
    } else {
        throw new Error('uploadCustomBg: invalid input');
    }
    blob = await convertToWebP(blob, 0.85);
    const filename = `${HB_PREFIX}_${charId}_bg_${bgId}.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Load custom page background as an object URL.
 */
export async function loadCustomBg(charId, bgId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_bg_${bgId}.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn(`${LOG} loadCustomBg:`, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Sticker Storage
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a sticker image file.
 * @returns {Promise<string>} Server path
 */
export async function uploadSticker(file, charId, stickerId, stHeaders) {
    let blob = (file instanceof Blob) ? file : dataUrlToBlob(file);
    blob = await convertToWebP(blob, 0.9);
    const filename = `${HB_PREFIX}_${charId}_sticker_${stickerId}.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Load a sticker image as an object URL.
 */
export async function loadStickerImage(charId, stickerId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_sticker_${stickerId}.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn(`${LOG} loadStickerImage:`, e);
        return null;
    }
}

/**
 * Delete a sticker file from ST file system.
 * Note: ST's /api/files/delete endpoint may not exist; we just remove from meta.
 */
export async function deleteSticker(charId, stickerId, stHeaders) {
    // ST doesn't have a file-delete API, so cleanup happens via meta only.
    console.log(`${LOG} Sticker ${stickerId} removed from meta (file remains on disk)`);
}

// ═══════════════════════════════════════════════════════════════════════
// Tape Storage
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a tape image file.
 * @returns {Promise<string>} Server path
 */
export async function uploadTape(file, charId, tapeId, stHeaders) {
    let blob = (file instanceof Blob) ? file : dataUrlToBlob(file);
    blob = await convertToWebP(blob, 0.9);
    const filename = `${HB_PREFIX}_${charId}_tape_${tapeId}.webp`;
    return uploadHandbookFile(blob, filename, stHeaders);
}

/**
 * Load a tape image as an object URL.
 */
export async function loadTapeImage(charId, tapeId, stHeaders) {
    try {
        const path = `/user/files/${HB_PREFIX}_${charId}_tape_${tapeId}.webp`;
        const response = await fetch(path, { headers: stHeaders });
        if (!response.ok) return null;
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn(`${LOG} loadTapeImage:`, e);
        return null;
    }
}


// ═══════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert any image file/blob to a WebP blob using an offscreen canvas.
 * This ensures that files stored with a .webp extension are truly WebP format,
 * preventing strict MIME checking failures in Safari/iOS.
 */
export function convertToWebP(blob, quality = 0.9) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((webpBlob) => {
                URL.revokeObjectURL(url);
                if (webpBlob) {
                    resolve(webpBlob);
                } else {
                    resolve(blob); // fallback to original
                }
            }, 'image/webp', quality);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(blob); // fallback to original
        };
        img.src = url;
    });
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
        throw new Error(`${LOG} Invalid data URL (empty or malformed). Canvas may be tainted by cross-origin resources.`);
    }
    const [header, data] = dataUrl.split(',');
    if (!data) {
        throw new Error(`${LOG} Data URL has no payload. Canvas export likely failed.`);
    }
    const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
}
