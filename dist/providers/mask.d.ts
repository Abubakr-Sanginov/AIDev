/**
 * Masks an API key for display. Short keys (8 characters or fewer) collapse to
 * a fixed placeholder because even partial fragments would reveal too much;
 * longer keys keep only the first 3 and last 4 characters (sk-…cdef).
 */
export declare function maskKey(key: string): string;
