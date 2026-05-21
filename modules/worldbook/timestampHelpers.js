// Stamps gf_createdAt / gf_updatedAt on a worldbook entry's extensions bag.
// These fields drive the "recent entries" sorting and per-card relative time
// display in the worldbook editor. They are read-only metadata for the LLM
// and the keyword matcher.
//
// Field names use a `gf_` prefix to avoid collisions with ST core or other
// extensions writing into the shared `extensions` object.

function ensureExtensions(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.extensions || typeof entry.extensions !== 'object') {
        entry.extensions = {};
    }
    return entry.extensions;
}

export function stampCreated(entry, now = Date.now()) {
    const ext = ensureExtensions(entry);
    if (!ext) return entry;
    ext.gf_createdAt = now;
    return entry;
}

export function stampUpdated(entry, now = Date.now()) {
    const ext = ensureExtensions(entry);
    if (!ext) return entry;
    ext.gf_updatedAt = now;
    return entry;
}
