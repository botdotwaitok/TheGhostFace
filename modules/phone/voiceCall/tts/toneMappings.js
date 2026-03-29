// modules/phone/voiceCall/tts/toneMappings.js
// Parses <say tone="...">text</say> tags from LLM output.
// Pattern borrowed from EntityWhisper's processText(), adapted for multi-segment support.

const LOG_PREFIX = '[ToneMappings]';

/**
 * Normalize Unicode punctuation to their ASCII equivalents.
 * LLMs may output `…` (U+2026), `"` `"` (U+201C/D), `'` `'` (U+2018/9),
 * `—` (U+2014), `–` (U+2013) etc. which can break regex matching or
 * cause sentences to be silently dropped during <say> tag parsing.
 * Fix ported from EntityWhisper's inline-tts.js (normalizeForMatch).
 * @param {string} s
 * @returns {string}
 */
function normalizeUnicode(s) {
    if (!s) return '';
    return s
        .replace(/\u2026/g, '...')           // … → ...
        .replace(/[\u201C\u201D]/g, '"')     // " " → "
        .replace(/[\u2018\u2019]/g, "'")     // ' ' → '
        .replace(/\u2014/g, '--')            // — → --
        .replace(/\u2013/g, '-')             // – → -
        .replace(/\u00A0/g, ' ');            // non-breaking space → space
}

/**
 * Parse all <say tone="...">...</say> segments from LLM output.
 *
 * @param {string} text - Raw LLM output containing <say> tags
 * @returns {{ segments: Array<{ tone: string, text: string }>, fullText: string, primaryTone: string }}
 *
 * @example
 *   parseSayTags('<say tone="gentle">"等你好久了。"</say>')
 *   → { segments: [{ tone: 'gentle', text: '"等你好久了。"' }],
 *       fullText: '"等你好久了。"',
 *       primaryTone: 'gentle' }
 */
export function parseSayTags(text) {
    if (!text) return { segments: [], fullText: '', primaryTone: 'default' };

    // Normalize Unicode punctuation before parsing to prevent
    // ellipsis / smart-quotes from breaking <say> tag extraction
    const normalized = normalizeUnicode(text);

    const SAY_REGEX = /<say\s+tone="([^"]*?)"\s*>(.*?)<\/say>/gis;
    const segments = [];
    const textParts = [];
    let lastIndex = 0;
    let match;

    while ((match = SAY_REGEX.exec(normalized)) !== null) {
        // Capture any text before this <say> block
        if (match.index > lastIndex) {
            const between = normalized.slice(lastIndex, match.index).trim();
            if (between) {
                textParts.push(between);
                segments.push({ tone: 'default', text: between });
            }
        }

        // Extract tone — take first comma-separated value
        const rawTones = match[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const tone = rawTones[0] || 'default';
        const innerText = match[2].trim();

        segments.push({ tone, text: innerText });
        textParts.push(innerText);
        lastIndex = match.index + match[0].length;
    }

    // If no <say> tags found, treat entire text as default
    if (segments.length === 0) {
        const cleaned = normalized.trim();
        console.debug(`${LOG_PREFIX} No <say> tags found, using default tone`);
        return {
            segments: [{ tone: 'default', text: cleaned }],
            fullText: cleaned,
            primaryTone: 'default',
        };
    }

    // Capture trailing text after last </say>
    if (lastIndex < normalized.length) {
        const trailing = normalized.slice(lastIndex).trim();
        if (trailing) {
            textParts.push(trailing);
            segments.push({ tone: 'default', text: trailing });
        }
    }

    const fullText = textParts.join(' ');
    const primaryTone = segments[0]?.tone || 'default';

    console.debug(`${LOG_PREFIX} Parsed ${segments.length} segment(s), primaryTone="${primaryTone}"`);
    return { segments, fullText, primaryTone };
}

/**
 * Strip all <say> tags from text, returning plain text for display.
 * @param {string} text
 * @returns {string}
 */
export function stripSayTags(text) {
    if (!text) return '';
    const normalized = normalizeUnicode(text);
    return normalized.replace(/<say\s+tone="[^"]*?"\s*>/gi, '').replace(/<\/say>/gi, '').trim();
}
