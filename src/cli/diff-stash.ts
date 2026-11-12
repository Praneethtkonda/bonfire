/**
 * Approved diffs, keyed by path, waiting for their tool result.
 *
 * The write/edit tools return only a status, but the user has just approved a
 * diff for that path. Holding it here lets the transcript show what actually
 * changed under the call ("Updated a.ts with 2 additions…") without touching
 * the tools themselves. A path approved with "always" isn't asked about again,
 * so later results for it fall back to a plain summary.
 */
const pending = new Map<string, string>();

export function stashDiff(path: string, diff: string): void {
  pending.set(path, diff);
}

/** Return and forget the stashed diff for `path`. */
export function takeDiff(path: string): string | undefined {
  const diff = pending.get(path);
  pending.delete(path);
  return diff;
}
