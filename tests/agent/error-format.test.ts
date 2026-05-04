import { describe, expect, it } from 'vitest';
import { formatProviderError } from '../../src/agent/error-format.js';

describe('formatProviderError', () => {
  it('detects API key issues', () => {
    expect(formatProviderError(new Error('Missing API key'))).toMatch(
      /Invalid or missing API key/,
    );
    expect(formatProviderError(new Error('api_key not provided'))).toMatch(
      /Invalid or missing API key/,
    );
  });

  it('detects 401 / Unauthorized', () => {
    expect(formatProviderError(new Error('HTTP 401 something'))).toMatch(
      /Authentication failed \(401\)/,
    );
    expect(formatProviderError(new Error('Unauthorized request'))).toMatch(
      /Authentication failed \(401\)/,
    );
  });

  it('detects 403 / Forbidden', () => {
    expect(formatProviderError(new Error('403 Forbidden'))).toMatch(
      /Forbidden \(403\)/,
    );
  });

  it('detects 429 / rate limit', () => {
    expect(formatProviderError(new Error('429 Too Many Requests'))).toMatch(
      /Rate limit exceeded/,
    );
    expect(formatProviderError(new Error('rate-limit reached'))).toMatch(
      /Rate limit exceeded/,
    );
  });

  it('detects 500', () => {
    expect(formatProviderError(new Error('500 Internal Server Error'))).toMatch(
      /Server error \(500\)/,
    );
  });

  it('detects 503 / unavailable', () => {
    expect(formatProviderError(new Error('503 Service Unavailable'))).toMatch(
      /Service unavailable/,
    );
    expect(formatProviderError(new Error('service is unavailable'))).toMatch(
      /Service unavailable/,
    );
  });

  it('detects connection failures', () => {
    expect(formatProviderError(new Error('connect ECONNREFUSED 127.0.0.1'))).toMatch(
      /Could not connect/,
    );
    expect(formatProviderError(new Error('getaddrinfo ENOTFOUND'))).toMatch(
      /Could not connect/,
    );
    expect(formatProviderError(new Error('EHOSTUNREACH'))).toMatch(/Could not connect/);
  });

  it('detects timeouts', () => {
    expect(formatProviderError(new Error('Request timed out'))).toMatch(
      /timed out/,
    );
    expect(formatProviderError(new Error('socket timeout'))).toMatch(/timed out/);
  });

  it('returns the raw message when no pattern matches', () => {
    expect(formatProviderError(new Error('mystery weirdness'))).toBe(
      'mystery weirdness',
    );
  });

  it('coerces non-Error values to a string', () => {
    expect(formatProviderError('plain string')).toBe('plain string');
    expect(formatProviderError(42)).toBe('42');
    expect(formatProviderError({ toString: () => 'obj' })).toBe('obj');
  });

  it('handles undefined / null gracefully', () => {
    expect(formatProviderError(undefined)).toBe('undefined');
    expect(formatProviderError(null)).toBe('null');
  });
});
