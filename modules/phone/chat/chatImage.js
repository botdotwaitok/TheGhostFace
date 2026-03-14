// modules/phone/chat/chatImage.js — Image message: selection, compression, lightbox
// Extracted from chatApp.js

import { escHtml, CHAT_LOG_PREFIX, scrollToBottom } from './chatApp.js';
import { getPendingImageData, setPendingImageData } from './chatApp.js';
import { renderDraftArea } from './chatMessageHandler.js';
import { updateButtonStates } from './chatApp.js';

const IMAGE_THUMBNAIL_MAX_SIZE = 800; // Max dimension for stored thumbnail

// ═════════════════════════════════════════════════════════════════════
// Image Message - Selection, Preview, Lightbox
// ═════════════════════════════════════════════════════════════════════

/**
 * Handle image file selection: read, compress, store as pending.
 * @param {File} file
 */
export async function handleImageSelection(file) {
    if (!file || !file.type.startsWith('image/')) return;

    // Check file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
        alert('图片文件过大（最大20MB）');
        return;
    }

    try {
        console.log(`${CHAT_LOG_PREFIX} 选择了图片: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);

        // Read file as base64
        const base64 = await _readFileAsBase64(file);

        // Create compressed thumbnail for display & storage
        const thumbnail = await _compressImage(base64, IMAGE_THUMBNAIL_MAX_SIZE);

        setPendingImageData({
            base64: base64,          // Full resolution for sending to API
            thumbnail: thumbnail,     // Compressed for display & localStorage
            fileName: file.name,
        });

        renderDraftArea();
        updateButtonStates();

        console.log(`${CHAT_LOG_PREFIX} 图片已加载到待发送区`);
    } catch (err) {
        console.error(`${CHAT_LOG_PREFIX} 图片加载失败:`, err);
        alert('图片加载失败，请重试');
    }
}

/**
 * Read a File as base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
function _readFileAsBase64(file) {
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
function _compressImage(dataUrl, maxDim) {
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

/**
 * Show the image lightbox with a full-size image.
 * @param {string} src - Image source URL or data URL
 */
export function showImageLightbox(src) {
    const lightbox = document.getElementById('chat_image_lightbox');
    const img = document.getElementById('chat_lightbox_img');
    if (!lightbox || !img) return;
    img.src = src;
    lightbox.classList.add('active');
}
