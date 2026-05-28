// modules/storage/fileStore.js — Thin wrapper around ST's /api/files/* endpoints
// for GhostFace JSON assets. Provides upload / fetch / delete + atomic write.
//
// HARD CONSTRAINTS (Phase 0 spike confirmed, see plan/storage-separation.md):
//   - No subdirectories. ST rejects any '/' in the filename.
//   - Filename charset strictly [a-zA-Z0-9_-] + .ext. Emoji / spaces / CJK
//     all rejected with 400.
//   - Same-name upload is overwrite (returns same path).
//   - No rename / move endpoint. Atomic writes simulated via tmp + verify.
//   - All writes MUST use getRequestHeaders() — bypassing it gets 403 from
//     ST's CSRF middleware before route matching.

import { getRequestHeaders } from '../../../../../../script.js';

const LOG = '[FileStore]';
const FILENAME_RE = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════

function assertValidName(name) {
    if (typeof name !== 'string' || !FILENAME_RE.test(name)) {
        throw new Error(
            `fileStore: invalid name "${name}" — only [a-zA-Z0-9_-]+ . [a-zA-Z0-9]+ allowed`
        );
    }
}

// UTF-8 safe base64 encode — payload may contain CJK / emoji.
function b64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

// Accept either a full server path ("/user/files/foo.json") or a bare name
// ("foo.json"). Bare names get the /user/files/ prefix; full paths pass through.
function resolvePath(pathOrName) {
    if (pathOrName.startsWith('/')) return pathOrName;
    if (pathOrName.startsWith('user/files/')) return `/${pathOrName}`;
    return `/user/files/${pathOrName}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Public API · raw file I/O
// ═══════════════════════════════════════════════════════════════════════

/**
 * Upload a UTF-8 string payload to /user/files/<name>. Same-name overwrites.
 * @param {string} name - flat filename matching [a-zA-Z0-9_-]+ . [a-zA-Z0-9]+
 * @param {string} content - any UTF-8 string
 * @returns {Promise<string>} the absolute server path
 */
export async function uploadFile(name, content) {
    assertValidName(name);
    const resp = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, data: b64Encode(content) }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`upload ${name} failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    const result = await resp.json().catch(() => ({}));
    const path = (result.path || `user/files/${name}`).replace(/\\/g, '/');
    return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Upload a Blob (binary payload, e.g. an image) to /user/files/<name>.
 * Same-name overwrites. Internally reads the blob as data URL then strips the
 * prefix to extract the pure base64 the upload endpoint expects.
 * @param {string} name - flat filename matching [a-zA-Z0-9_-]+ . [a-zA-Z0-9]+
 * @param {Blob} blob
 * @returns {Promise<string>} the absolute server path
 */
export async function uploadBlob(name, blob) {
    assertValidName(name);
    const base64 = await _blobToBase64(blob);
    const resp = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, data: base64 }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`uploadBlob ${name} failed: ${resp.status} ${body.slice(0, 200)}`);
    }
    const result = await resp.json().catch(() => ({}));
    const path = (result.path || `user/files/${name}`).replace(/\\/g, '/');
    return path.startsWith('/') ? path : `/${path}`;
}

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result || '';
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * Fetch a file as a UTF-8 string. Returns null on 404 (file not present),
 * throws on other errors.
 * @param {string} pathOrName
 * @returns {Promise<string|null>}
 */
export async function fetchFile(pathOrName) {
    const url = resolvePath(pathOrName);
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
    return await resp.text();
}

/**
 * Delete a file. Best-effort: returns true on server-confirmed delete,
 * false on any failure (network, 4xx, 5xx). Never throws.
 * @param {string} pathOrName
 * @returns {Promise<boolean>}
 */
export async function deleteFile(pathOrName) {
    const path = resolvePath(pathOrName);
    try {
        const resp = await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
        if (!resp.ok) {
            console.warn(`${LOG} delete ${path} returned ${resp.status}`);
        }
        return resp.ok;
    } catch (e) {
        console.warn(`${LOG} delete ${path} threw:`, e);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API · JSON helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Read a JSON file and parse it. Returns null on 404. Throws on parse error
 * so the caller can distinguish "no file yet" from "corrupted file".
 * @param {string} name
 * @returns {Promise<any|null>}
 */
export async function readJSON(name) {
    const text = await fetchFile(name);
    if (text === null) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`readJSON ${name}: invalid JSON (${e.message})`);
    }
}

/**
 * Atomic write of a JSON value. ST file API has no rename (Phase 0 confirmed),
 * so atomicity is simulated:
 *   1. Write to <basename>_tmp.<ext>
 *   2. Read tmp back and verify byte-equality (catches HTTP-cut-mid-upload)
 *   3. Overwrite the real name (same-name upload is OK per Phase 0)
 *   4. Best-effort delete of tmp (orphan tmp on crash is benign — startup
 *      recovery, owned by the calling store, scans + reconciles)
 *
 * @param {string} name - flat filename
 * @param {any} data - JSON-serializable value
 * @returns {Promise<string>} absolute path of the written file
 */
export async function atomicWriteJSON(name, data) {
    assertValidName(name);
    const json = JSON.stringify(data);
    const tmpName = tmpNameFor(name);

    await uploadFile(tmpName, json);

    const readback = await fetchFile(tmpName);
    if (readback !== json) {
        throw new Error(
            `atomicWriteJSON ${name}: tmp verify failed ` +
            `(got ${readback?.length ?? 'null'} bytes, expected ${json.length})`
        );
    }

    const finalPath = await uploadFile(name, json);

    // Best-effort cleanup. Failure does NOT compromise data integrity —
    // the real file is already in place and verified-good via the tmp copy.
    deleteFile(tmpName).catch(() => {});

    return finalPath;
}

/**
 * Derive the tmp filename used by atomicWriteJSON. Exported so startup
 * recovery code in higher-level stores can probe for orphans deterministically
 * (ST has no list endpoint — recovery must guess names).
 * @param {string} name
 * @returns {string}
 */
export function tmpNameFor(name) {
    assertValidName(name);
    return name.replace(/\.([a-zA-Z0-9]+)$/, '_tmp.$1');
}
