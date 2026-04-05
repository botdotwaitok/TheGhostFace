// modules/phone/discord/discordImage.js — Image handling for Discord channel chat
// Handles: file selection, compression, pending state, lightbox viewing.
// Standalone module (does not depend on chatImage.js state).

const LOG = '[Discord Image]';
const IMAGE_THUMBNAIL_MAX_SIZE = 800; // Max dimension for stored thumbnail

// ═══════════════════════════════════════════════════════════════════════
// File Reading & Compression
// ═══════════════════════════════════════════════════════════════════════

/**
 * Read a File as base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/**
 * Compress an image to a maximum dimension while preserving aspect ratio.
 * Returns a JPEG data URL.
 * @param {string} dataUrl - Source image data URL
 * @param {number} maxDim - Maximum width or height
 * @returns {Promise<string>}
 */
export function compressImage(dataUrl, maxDim) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const ratio = Math.min(maxDim / width, maxDim / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Image Selection Handler
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle image file selection: validate, read, compress, return data via callback.
 * @param {File} file
 * @param {Function} onReady - Called with { base64, thumbnail, fileName }
 */
export async function handleDiscordImageSelection(file, onReady) {
    if (!file || !file.type.startsWith('image/')) return;

    // Check file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
        alert('图片文件过大（最大20MB）');
        return;
    }

    try {
        console.log(`${LOG} 选择了图片: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);

        // Read file as base64
        const base64 = await readFileAsBase64(file);

        // Create compressed thumbnail for display & storage
        const thumbnail = await compressImage(base64, IMAGE_THUMBNAIL_MAX_SIZE);

        const imageData = {
            base64,          // Full resolution for sending to API (vision)
            thumbnail,       // Compressed for display & localStorage
            fileName: file.name,
        };

        console.log(`${LOG} 图片已加载`);
        if (onReady) onReady(imageData);

    } catch (err) {
        console.error(`${LOG} 图片加载失败:`, err);
        alert('图片加载失败，请重试');
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Image Lightbox
// ═══════════════════════════════════════════════════════════════════════

/**
 * Show the Discord image lightbox with a full-size image.
 * @param {string} src - Image source URL or data URL
 */
export function showDiscordImageLightbox(src) {
    const lightbox = document.getElementById('dc_image_lightbox');
    const img = document.getElementById('dc_lightbox_img');
    if (!lightbox || !img) return;
    img.src = src;
    lightbox.classList.add('active');
}
