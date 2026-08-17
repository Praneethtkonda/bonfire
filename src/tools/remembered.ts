/**
 * Session-scoped "always allow" memory.
 *
 * The approval prompt offers `always`, which previously only did anything for
 * the shell tool — file edits and MCP calls treated it as a one-shot `yes` and
 * re-prompted on the very next call. This is the shared store behind all three.
 *
 * Entries live for the lifetime of the process and are cleared whenever the
 * user starts a fresh conversation (`/sessions new`), so an approval granted in
 * one session never silently carries into the next.
 */
export type ApprovalScope = 'shell' | 'file' | 'mcp' | 'fetch';

const remembered = new Set<string>();

function keyFor(scope: ApprovalScope, key: string): string {
  return `${scope}\u0000${key.trim()}`;
}

export function rememberApproval(scope: ApprovalScope, key: string): void {
  remembered.add(keyFor(scope, key));
}

export function isApprovalRemembered(scope: ApprovalScope, key: string): boolean {
  return remembered.has(keyFor(scope, key));
}

/** Drop every remembered approval. Called on `/sessions new` and by tests. */
export function resetRememberedApprovals(): void {
  remembered.clear();
}

export function rememberedCount(): number {
  return remembered.size;
}
