export type NodeKind = 'dir' | 'file';

export interface CodemapNode {
  /** POSIX path relative to repo root. Root node is "". */
  path: string;
  /** Last path segment, for display. */
  name: string;
  kind: NodeKind;
  /**
   * Regex-extracted one-liner (language, LOC, exports, top comment).
   * Always present — built on first walk, cheap, no LLM.
   */
  skeleton: string;
  /**
   * LLM-generated one-sentence summary of what this file/dir *does*.
   * Present only after a codemap build pass.
   */
  summary?: string;
  /** ms-since-epoch when `summary` was last written; used for staleness checks. */
  summarizedAt?: number;
  /**
   * ms-since-epoch when the last summarization attempt failed. Set instead of
   * caching a fake summary, so the next build retries this node.
   */
  summaryFailedAt?: number;
  /** Children for dirs; empty/undefined for files. */
  children?: CodemapNode[];
  /** File size in bytes (files only). */
  size?: number;
  /** File mtime (ms since epoch) — used to invalidate skeleton + summary on change. */
  mtime?: number;
}

export interface Codemap {
  version: 1;
  /** Absolute path of the indexed repo root, captured at build time. */
  root: string;
  /** ms since epoch of the last full walk. */
  builtAt: number;
  /** ms since epoch of the last LLM summarization pass (0 if never). */
  summarizedAt: number;
  tree: CodemapNode;
}

export interface CodemapStats {
  files: number;
  dirs: number;
  summarized: number;
  bytes: number;
}
