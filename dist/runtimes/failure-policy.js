/**
 * Classifies runtime diagnostics so the orchestrator can stop retrying errors
 * that no amount of retries can fix (billing, quota, authentication, missing
 * model). Transient failures (rate limits, 5xx, timeouts) stay retryable.
 */
const FATAL_DIAGNOSTIC = /\bHTTP\s*(?:400|401|402|403|404)\b|\bstatus(?:\s*code)?\s*[:=]?\s*(?:400|401|402|403|404)\b|(?:free[_ -]?)?quota\s*(?:exhausted)?|insufficient[_ ]?(?:quota|funds|credits?)|exceeded\s+your\s+(?:current\s+)?(?:quota|plan)|billing|payment|required\s+plan|unauthorized|forbidden|invalid[ _-](?:api[ _-]?key|token|model)|not[ _-]?authenticated|provider[ _-]?auth|no\s+such\s+model|model[ _-]not[ _-]found|credit\b/i;
export function isFatalDiagnostic(message) {
    return FATAL_DIAGNOSTIC.test(message);
}
