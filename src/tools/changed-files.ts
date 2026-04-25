export interface FileChange {
  writes: number;
  edits: number;
  bytes: number;
}

export const changedFiles = new Map<string, FileChange>();

export function trackChange(path: string, kind: 'write' | 'edit', bytes: number) {
  const prev = changedFiles.get(path) ?? { writes: 0, edits: 0, bytes: 0 };
  if (kind === 'write') prev.writes += 1;
  else prev.edits += 1;
  prev.bytes = bytes;
  changedFiles.set(path, prev);
}
