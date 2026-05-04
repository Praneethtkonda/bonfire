/**
 * Single source of truth for translating provider/network errors into
 * human-friendly messages. Used by the agent runner, the stream normalizer,
 * and the TUI hook so the user sees the same wording regardless of where
 * the failure surfaces.
 */
export function formatProviderError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (/api[\s_-]?key/i.test(msg)) {
    return 'Invalid or missing API key. Use /reconfigure to update credentials.';
  }
  if (/\b401\b|Unauthorized/i.test(msg)) {
    return 'Authentication failed (401). Check your API key with /config or /reconfigure.';
  }
  if (/\b403\b|Forbidden/i.test(msg)) {
    return 'Forbidden (403). Check your API key permissions.';
  }
  if (/\b429\b|rate[\s-]?limit/i.test(msg)) {
    return 'Rate limit exceeded (429). Please wait and try again.';
  }
  if (/\b500\b/.test(msg)) {
    return 'Server error (500). The model service may be down.';
  }
  if (/\b503\b|unavailable/i.test(msg)) {
    return 'Service unavailable (503). The model service may be overloaded.';
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|connect/i.test(msg)) {
    return 'Could not connect to the model server. Is the provider running?';
  }
  if (/timeout|timed out/i.test(msg)) {
    return 'Request timed out. The model may be slow or unresponsive.';
  }
  return msg;
}
