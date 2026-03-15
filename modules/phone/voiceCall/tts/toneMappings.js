// modules/phone/voiceCall/tts/toneMappings.js
// Parses <say tone="...">text</say> tags from LLM output.
// Pattern borrowed from EntityWhisper's processText(), adapted for multi-segment support.

const LOG_PREFIX = '[ToneMappings]';

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

    const SAY_REGEX = /<say\s+tone="([^"]*?)"\s*>(.*?)<\/say>/gis;
    const segments = [];
    const textParts = [];
    let lastIndex = 0;
    let match;

    while ((match = SAY_REGEX.exec(text)) !== null) {
        // Capture any text before this <say> block
        if (match.index > lastIndex) {
            const between = text.slice(lastIndex, match.index).trim();
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
        const cleaned = text.trim();
        console.debug(`${LOG_PREFIX} No <say> tags found, using default tone`);
        return {
            segments: [{ tone: 'default', text: cleaned }],
            fullText: cleaned,
            primaryTone: 'default',
        };
    }

    // Capture trailing text after last </say>
    if (lastIndex < text.length) {
        const trailing = text.slice(lastIndex).trim();
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
    return text.replace(/<say\s+tone="[^"]*?"\s*>/gi, '').replace(/<\/say>/gi, '').trim();
}
