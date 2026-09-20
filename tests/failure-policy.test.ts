import { describe, expect, it } from 'vitest';
import { isFatalDiagnostic, isProviderDiagnostic } from '../src/runtimes/failure-policy.js';

describe('failure policy', () => {
  it('treats billing, quota, and auth errors as fatal', () => {
    for (const message of [
      'HTTP 401: invalid api key',
      'HTTP 402: insufficient quota',
      'quota exhausted',
      'no such model: gpt-x',
    ])
      expect(isFatalDiagnostic(message)).toBe(true);
  });

  it('recognises provider-side transient failures', () => {
    for (const message of [
      'HTTP 429: rate limit reached',
      'HTTP 503: service unavailable',
      'fetch failed',
      'read ECONNRESET',
      'request timed out after 120000ms',
      'The operation was aborted due to timeout',
      'HTTP 500: internal error',
    ])
      expect(isProviderDiagnostic(message)).toBe(true);
  });

  it('treats our own internal errors as not provider-side', () => {
    for (const message of [
      'Tool call budget exhausted (max 20).',
      'Safety ceiling reached after 40 steps without a final answer.',
      'Architect did not create or modify files.',
      "Tool 'write_file' is not allowed in read-only mode.",
      'Operation was not approved.',
      'Invalid tool arguments JSON for read_file.',
      'oldText was not found.',
    ])
      expect(isProviderDiagnostic(message)).toBe(false);
  });
});
