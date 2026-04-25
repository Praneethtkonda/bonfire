import { generateText } from 'ai';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveProvider } from '../providers/index.js';
import type { Codemap, CodemapNode } from './types.js';

const MAX_FILE_CHARS = 8000;
const MAX_DIR_CHILDREN_FOR_PROMPT = 40;

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
  /** Max concurrent LLM calls. Local models are slow; keep this small. */
  concurrency?: number;
  /**
   * Called whenever a node summary completes. Used by the TUI for a live
   * "123 / 456 summarized" counter.
   */
  onProgress?: (done: number, total: number, path: string) => void;
  /** If true, re-summarize even nodes that already have a `summary`. */
  force?: boolean;
  /** Abort mid-pass. */
  signal?: AbortSignal;
}

export async function summarizeCodemap(
  map: Codemap,
  options: SummarizeOptions = {},
): Promise<Codemap> {
  const provider = await resolveProvider();
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const force = options.force ?? false;

  const files: CodemapNode[] = [];
  const dirs: CodemapNode[] = [];
  collect(map.tree, files, dirs);

  const fileTargets = files.filter((n) => force || !n.summary);
  const total = fileTargets.length + dirs.length;
  let done = 0;

  // Pass 1: files in parallel (bounded).
  await runBounded(fileTargets, concurrency, async (node) => {
    if (options.signal?.aborted) return;
    try {
      node.summary = await summarizeFile(provider.model, map.root, node);
    } catch (e: any) {
      node.summary = node.skeleton; // fall back so we don't re-query next time
      if (process.env.BONFIRE_DEBUG === '1') {
        console.error(`[codemap] summarize failed for ${node.path}: ${e.message ?? e}`);
      }
    }
    done += 1;
    options.onProgress?.(done, total, node.path);
  });

  // Pass 2: dirs bottom-up. Children must be summarized first for the roll-up to make sense.
  const bottomUp = [...dirs].sort((a, b) => depth(b.path) - depth(a.path));
  for (const node of bottomUp) {
    if (options.signal?.aborted) break;
    if (!force && node.summary) {
      done += 1;
      options.onProgress?.(done, total, node.path);
      continue;
    }
    try {
      node.summary = await summarizeDir(provider.model, node);
    } catch (e: any) {
      node.summary = node.skeleton;
      if (process.env.BONFIRE_DEBUG === '1') {
        console.error(`[codemap] dir-summarize failed for ${node.path}: ${e.message ?? e}`);
      }
    }
    done += 1;
    options.onProgress?.(done, total, node.path);
  }

  map.summarizedAt = Date.now();
  return map;
}

async function summarizeFile(model: any, root: string, node: CodemapNode): Promise<string> {
  const abs = resolve(root, node.path);
  let head = '';
  try {
    const buf = await readFile(abs);
    head = buf.subarray(0, MAX_FILE_CHARS).toString('utf-8');
  } catch {
    return node.skeleton;
  }
  const prompt = [
    `Path: ${node.path}`,
    `Skeleton: ${node.skeleton}`,
    '---',
    head,
    head.length >= MAX_FILE_CHARS ? '...[truncated]' : '',
  ].join('\n');

  const { text } = await generateText({
    model,
    system: FILE_SYSTEM_PROMPT,
    prompt,
    temperature: 0.1,
  });
  return cleanOneLiner(text);
}

async function summarizeDir(model: any, node: CodemapNode): Promise<string> {
  const children = (node.children ?? []).slice(0, MAX_DIR_CHILDREN_FOR_PROMPT);
  const lines = children.map((c) => {
    const marker = c.kind === 'dir' ? 'dir' : 'file';
    return `- [${marker}] ${c.name} — ${c.summary ?? c.skeleton}`;
  });
  const overflow = (node.children?.length ?? 0) - children.length;
  if (overflow > 0) lines.push(`- ...and ${overflow} more`);

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
