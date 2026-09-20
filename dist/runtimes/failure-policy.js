/**
 * Classifies runtime diagnostics so the orchestrator can stop retrying errors
 * that no amount of retries can fix (billing, quota, authentication, missing
 * model). Transient failures (rate limits, 5xx, timeouts) stay retryable.
 */
const FATAL_DIAGNOSTIC = /\bHTTP\s*(?:400|401|402|403|404)\b|\bstatus(?:\s*code)?\s*[:=]?\s*(?:400|401|402|403|404)\b|(?:free[_ -]?)?quota\s*(?:exhausted)?|insufficient[_ ]?(?:quota|funds|credits?)|exceeded\s+your\s+(?:current\s+)?(?:quota|plan)|billing|payment|required\s+plan|unauthorized|forbidden|invalid[ _-](?:api[ _-]?key|token|model)|not[ _-]?authenticated|provider[ _-]?auth|no\s+such\s+model|model[ _-]not[ _-]found|credit\b/i;
export function isFatalDiagnostic(message) {
    return FATAL_DIAGNOSTIC.test(message);
}
/**
 * Diagnostics that originate on the provider/model side: rate limits, server
 * errors, timeouts, and network failures. The orchestrator reports those as
 * FAILED because only the provider can fix them. Everything else (internal
 * budgets, verification mismatches, rejected approvals) is our own problem and
 * must not mark a role failed.
 */
const PROVIDER_DIAGNOSTIC = /\bHTTP\s*\d{3}\b|\b(?:status(?: code)?|code)\s*[:=]?\s*(?:4\d\d|5\d\d)\b|rate[ _-]?limit|too many requests|\b429\b|\b(?:5\d\d)\b\s*(?:error|status)?|overloaded|temporarily unavailable|service unavailable|timed?[ _-]?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error|connection (?:reset|closed|refused)/i;
export function isProviderDiagnostic(message) {
    return isFatalDiagnostic(message) || PROVIDER_DIAGNOSTIC.test(message);
}
