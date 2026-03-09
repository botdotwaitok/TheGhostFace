// modules/phone/utils/llmJsonCleaner.js

/**
 * Enhanced JSON cleaner for LLM responses.
 * 
 * Many LLMs wrap their JSON output in markdown code blocks (` ```json `),
 * or include conversational filler before/after the actual JSON object.
 * Simple regex replacements often fail when the JSON contains the word "json"
 * or if there are unexpected backticks.
 * 
 * This utility:
 * 1. Strips common markdown code block fences.
 * 2. Scans for the first '{' (object) or '[' (array).
 * 3. Uses depth tracking to find the matching closing bracket '}' or ']'.
 * 4. Extracts exactly that substring, ignoring any prefix/suffix garbage.
 * 5. Properly handles string literals so brackets inside strings don't mess up the depth count.
 * 
 * @param {string} raw - The raw string response from the LLM.
 * @returns {string} The extracted, clean JSON string (ready for JSON.parse).
 */
export function cleanLlmJson(raw) {
    if (!raw || typeof raw !== 'string') return '';

    // 1. Strip standard code fences first, just to get them out of the way
    let text = raw.replace(/```(?:json|JSON)?\s*/g, '').trim();
    
    // Quick check to see if we even have brackets
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    
    if (firstBrace === -1 && firstBracket === -1) {
        return text; // Nothing we can extract, return as-is
    }

    // Determine what we're looking for (object or array)
    // Find whichever comes first, but if one is missing (-1), use the other
    let openChar, closeChar;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        openChar = '{';
        closeChar = '}';
    } else {
        openChar = '[';
        closeChar = ']';
    }
    
    let depth = 0;
    let start = -1;
    let end = -1;
    let inString = false;
    let escaped = false;
    
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        
        if (escaped) { 
            escaped = false; 
            continue; 
        }
        if (ch === '\\' && inString) { 
            escaped = true; 
            continue; 
        }
        if (ch === '"') { 
            inString = !inString; 
            continue; 
        }
        
        if (inString) continue; // Ignore braces inside strings!
        
        if (ch === openChar) { 
            if (start === -1) start = i; 
            depth++; 
        }
        if (ch === closeChar) { 
            depth--; 
            if (depth === 0 && start !== -1) { 
                end = i; 
                break; // Found the end of the root object/array!
            } 
        }
    }
    
    // If we successfully found a balanced structure, extract it
    if (start !== -1 && end !== -1) {
        text = text.substring(start, end + 1);
    }
    
    return text.trim();
}
