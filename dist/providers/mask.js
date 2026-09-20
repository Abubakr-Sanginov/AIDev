/**
 * Masks an API key for display. Short keys (8 characters or fewer) collapse to
 * a fixed placeholder because even partial fragments would reveal too much;
 * longer keys keep only the first 3 and last 4 characters (sk-…cdef).
 */
export function maskKey(key) {
    if (key.length <= 8)
        return '••••';
    return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
