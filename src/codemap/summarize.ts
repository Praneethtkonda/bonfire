import { generateText, type LanguageModel } from 'ai';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { resolveProvider } from '../providers/index.js';
import { saveCodemap } from './store.js';
import type { Codemap, CodemapNode } from './types.js';

const MAX_FILE_BYTES = 8000;
const MAX_DIR_CHILDREN_FOR_PROMPT = 40;
const MAX_FILES_PER_EXT = 6;

const FILE_SYSTEM_PROMPT = `You summarize source files for a code index.

Rules:
- ONE sentence, at most 25 words.
- Say what the file DOES or EXPORTS, not what language it is in.
- No fluff ("this file...", "the code..."). Start with a verb or noun phrase.
- If the file is trivial, say so bluntly ("Re-exports barrel.", "Type aliases only.").

Bad:  This TypeScript file contains authentication logic.
Good: JWT signing, verification, and refresh-token rotation; 15-min access tokens.`;

const DIR_SYSTEM_PROMPT = `You summarize directories in a code index.

Rules:
- ONE sentence, at most 25 words.
- Describe the concern shared by the children, not the number of files.
- If children are unrelated, list the top 2-3 concerns separated by semicolons.
- No fluff. Start with a noun phrase.

Bad:  This directory contains 12 TypeScript files about authentication.
Good: OAuth + JWT auth stack: token signing, session store, Google/GitHub providers.`;

export interface SummarizeOptions {
  /**
   * Max concurrent LLM calls. Defaults to config.codemap.concurrency (which
   * itself defaults to 3 if unset). Local models are slow; remote APIs can
   * comfortably push 10-20.
   */
  concurrency?: number;
  /** Live "n / total summarized" callback for the TUI. */
  onProgress?: (done: number, total: number, path: string) => void;
  /** If true, re-summarize even nodes that already have a `summary`. */
  force?: boolean;
  /** Abort mid-pass. */
  signal?: AbortSignal;
  /** Persist progress every N completed summaries (default: 25). 0 disables. */
  checkpointEvery?: number;
}

export async function summarizeCodemap(
  map: Codemap,
  options: SummarizeOptions = {},
): Promise<Codemap> {
  const provider = await resolveProvider();
  const cfg = await loadConfig();
  const concurrency = Math.max(
    1,
    options.concurrency ?? cfg.codemap?.concurrency ?? 3,
  );
  const force = options.force ?? false;
  const checkpointEvery = options.checkpointEvery ?? 25;

  const files: CodemapNode[] = [];
  const dirs: CodemapNode[] = [];
  collect(map.tree, files, dirs);

  const fileTargets = files.filter((n) => force || !n.summary);
  const total = fileTargets.length + dirs.length;
  let done = 0;
  let sinceCheckpoint = 0;
  let checkpointInFlight: Promise<void> | null = null;

  const checkpoint = () => {
    if (checkpointEvery <= 0 || checkpointInFlight) return;
    checkpointInFlight = saveCodemap(map.root, map)
      .catch((e) => {
        if (process.env.BONFIRE_DEBUG === '1') {
          console.error(`[codemap] checkpoint failed: ${(e as Error).message ?? e}`);
        }
      })
      .finally(() => {
        checkpointInFlight = null;
      });
  };

  const recordProgress = (path: string) => {
    done += 1;
    sinceCheckpoint += 1;
    // Skip the `onProgress` callback once aborted so a torn-down build can't
    // keep pushing updates into the TUI after the user pressed Esc.
    if (options.signal?.aborted) return;
    options.onProgress?.(done, total, path);
    if (checkpointEvery > 0 && sinceCheckpoint >= checkpointEvery) {
      sinceCheckpoint = 0;
      checkpoint();
    }
  };

  // Pass 1: files in parallel (bounded).
  await runBounded(fileTargets, concurrency, async (node) => {
    if (options.signal?.aborted) return;
    try {
      node.summary = await summarizeFile(provider.model, map.root, node);
      node.summarizedAt = Date.now();
      node.summaryFailedAt = undefined;
    } catch (e: unknown) {
      // Don't poison the cache. Leaving `summary` undefined makes the next
      // build retry this node automatically.
      node.summary = undefined;
      node.summaryFailedAt = Date.now();
      if (process.env.BONFIRE_DEBUG === '1') {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[codemap] summarize failed for ${node.path}: ${msg}`);
      }
    }
    recordProgress(node.path);
  });

  // Pass 2: dirs bottom-up so children are summarized before their parent.
  const bottomUp = [...dirs].sort((a, b) => depth(b.path) - depth(a.path));
  for (const node of bottomUp) {
    if (options.signal?.aborted) break;
    if (!force && node.summary) {
      recordProgress(node.path);
      continue;
    }
    try {
      node.summary = await summarizeDir(provider.model, node);
      node.summarizedAt = Date.now();
      node.summaryFailedAt = undefined;
    } catch (e: unknown) {
      node.summary = undefined;
      node.summaryFailedAt = Date.now();
      if (process.env.BONFIRE_DEBUG === '1') {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[codemap] dir-summarize failed for ${node.path}: ${msg}`);
      }
    }
    recordProgress(node.path);
  }

  map.summarizedAt = Date.now();
  if (checkpointInFlight) await checkpointInFlight;
  return map;
}

async function summarizeFile(
  model: LanguageModel,
  root: string,
  node: CodemapNode,
): Promise<string> {
  const abs = resolve(root, node.path);
  const head = await readHead(abs, MAX_FILE_BYTES);
  if (!head) {
    // Couldn't read the file at all — leave the skeleton-derived label as the
    // summary. This is rare (permissions errors).
    return node.skeleton;
  }
  const prompt = [
    `Path: ${node.path}`,
    `Skeleton: ${node.skeleton}`,
    '---',
    head,
    head.length >= MAX_FILE_BYTES ? '...[truncated]' : '',
  ].join('\n');

  const { text } = await generateText({
    model,
    system: FILE_SYSTEM_PROMPT,
    prompt,
    temperature: 0.1,
  });
  return cleanOneLiner(text);
}

/**
 * Decode up to `maxBytes` of the file as UTF-8 with `stream: true`, which
 * drops any trailing partial codepoint instead of producing a U+FFFD.
 */
async function readHead(abs: string, maxBytes: number): Promise<string> {
  try {
    const buf = await readFile(abs);
    const slice = buf.subarray(0, maxBytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(slice, { stream: true });
  } catch {
    return '';
  }
}

interface PickedChildren {
  /** Child entries to render, with overflow lines appended at the end. */
  lines: string[];
}

/**
 * Pick a representative subset of a dir's children for the summarization
 * prompt: include every subdirectory (always), then bucket files by extension
 * and take the top `MAX_FILES_PER_EXT` per bucket sorted by size descending.
 * The remainder is reported as an overflow line per extension so the model
 * still knows what's there.
 */
function pickDirChildrenForPrompt(node: CodemapNode): PickedChildren {
  const all = node.children ?? [];
  const dirs = all.filter((c) => c.kind === 'dir');
  const files = all.filter((c) => c.kind === 'file');

  const filesByExt = new Map<string, CodemapNode[]>();
  for (const f of files) {
    const ext = extname(f.name).toLowerCase() || '(none)';
    const bucket = filesByExt.get(ext) ?? [];
    bucket.push(f);
    filesByExt.set(ext, bucket);
  }

  const includedFiles: CodemapNode[] = [];
  const overflow: Array<{ ext: string; count: number }> = [];
  const sortedExts = [...filesByExt.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [ext, bucket] of sortedExts) {
    bucket.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    includedFiles.push(...bucket.slice(0, MAX_FILES_PER_EXT));
    if (bucket.length > MAX_FILES_PER_EXT) {
      overflow.push({ ext, count: bucket.length - MAX_FILES_PER_EXT });
    }
  }

  // Hard cap on rendered children. Always keep dirs, trim files first.
  const total = dirs.length + includedFiles.length;
  if (total > MAX_DIR_CHILDREN_FOR_PROMPT) {
    const room = Math.max(0, MAX_DIR_CHILDREN_FOR_PROMPT - dirs.length);
    const dropped = includedFiles.length - room;
    includedFiles.length = room;
    if (dropped > 0) overflow.push({ ext: 'misc', count: dropped });
  }

  const renderChild = (c: CodemapNode, marker: string) => {
    let desc = c.summary ?? '';
    if (!desc) {
      desc = c.summaryFailedAt ? '(unsummarized)' : c.skeleton;
    }
    return `- [${marker}] ${c.name} — ${desc}`;
  };

  const lines: string[] = [];
  for (const d of dirs) lines.push(renderChild(d, 'dir'));
  for (const f of includedFiles) lines.push(renderChild(f, 'file'));
  if (overflow.length) {
    const ovStr = overflow.map((o) => `${o.count} more ${o.ext}`).join(', ');
    lines.push(`- ...and ${ovStr}`);
  }
  return { lines };
}

async function summarizeDir(model: LanguageModel, node: CodemapNode): Promise<string> {
  const { lines } = pickDirChildrenForPrompt(node);
  const prompt = [
    `Directory: ${node.path || '.'}`,
    'Children:',
    ...lines,
  ].join('\n');

  const { text } = await generateText({
    model,
    system: DIR_SYSTEM_PROMPT,
    prompt,
    temperature: 0.1,
  });
  return cleanOneLiner(text);
}

function collect(node: CodemapNode, files: CodemapNode[], dirs: CodemapNode[]) {
  if (node.kind === 'file') files.push(node);
  else {
    dirs.push(node);
    for (const c of node.children ?? []) collect(c, files, dirs);
  }
}

function depth(path: string): number {
  if (!path) return 0;
  return path.split('/').length;
}

async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) {
    runners.push(
      (async () => {
        while (i < items.length) {
          const my = i++;
          await worker(items[my]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

function cleanOneLiner(text: string): string {
  // Strip code fences, collapse whitespace, clip to a single sentence.
  let t = text.replace(/^```[\s\S]*?```/gm, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  // Some small models wrap their answer in quotes.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  // Keep first sentence-ish unit.
  const firstNl = t.indexOf('\n');
  if (firstNl !== -1) t = t.slice(0, firstNl).trim();
  if (t.length > 200) t = t.slice(0, 199) + '…';
  return t;
}

export { pickDirChildrenForPrompt };
