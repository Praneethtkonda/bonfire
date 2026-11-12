import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getConfigPath } from '../config.js';

/**
 * Agentic memory, in the style Claude Code uses: plain Markdown files the
 * assistant reads at the start of every turn and adds to as it learns.
 *
 *   repo  <repo>/.bonfire/memory/   facts about this project; can be
 *                                       committed so the team shares them
 *   user  <config dir>/memory/          your preferences, across all repos
 *
 * Each scope has an index, MEMORY.md, loaded into the system prompt (first
 * 200 lines), and optional topic files (e.g. testing.md) read on demand.
 * Files stay human-readable and editable; nothing is hidden in a database.
 */

export type MemoryScope = 'repo' | 'user';

// Follows `memory` in the config; refreshed each time the system prompt is built.
let enabled = true;

export function setMemoryEnabled(on: boolean): void {
  enabled = on;
}

export function isMemoryEnabled(): boolean {
  return enabled;
}
export const MEMORY_SCOPES: MemoryScope[] = ['repo', 'user'];

export const MEMORY_INDEX = 'MEMORY.md';
export const INDEX_MAX_LINES = 200;
const INDEX_MAX_CHARS = 12_000;
export const NOTE_MAX_CHARS = 1_000;

export function memoryDir(scope: MemoryScope, cwd: string = process.cwd()): string {
  return scope === 'repo' ? resolve(cwd, '.bonfire', 'memory') : resolve(dirname(getConfigPath()), 'memory');
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

export function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** `Testing Notes` → `testing-notes`. Empty when nothing usable is left. */
export function topicSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function topicFile(topic?: string): string {
  if (!topic) return MEMORY_INDEX;
  const slug = topicSlug(topic);
  if (!slug || slug === 'memory') return MEMORY_INDEX;
  return `${slug}.md`;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

function header(scope: MemoryScope): string {
  return scope === 'repo'
    ? '# Project memory\n\nNotes Bonfire keeps about this repository. Edit freely.\n'
    : '# Personal memory\n\nNotes Bonfire keeps about you, used in every repository. Edit freely.\n';
}

function isNote(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

function normalise(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim().toLowerCase();
}

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
  duplicate?: boolean;
}

export async function saveMemory(
  input: { scope: MemoryScope; note: string; topic?: string },
  cwd: string = process.cwd(),
): Promise<SaveResult> {
  const note = input.note.replace(/\s+/g, ' ').trim();
  if (!note) return { ok: false, error: 'the note is empty' };
  if (note.length > NOTE_MAX_CHARS) {
    return { ok: false, error: `keep a note under ${NOTE_MAX_CHARS} characters; split it or use a topic` };
  }
  if (looksSecret(note)) {
    return { ok: false, error: 'the note looks like it contains a secret; memory never stores secrets' };
  }

  const dir = memoryDir(input.scope, cwd);
  await mkdir(dir, { recursive: true });
  const file = topicFile(input.topic);
  const path = join(dir, file);
  const existing =
    (await readText(path)) ?? (file === MEMORY_INDEX ? header(input.scope) : `# ${input.topic}\n\n`);
  if (existing.split('\n').some((l) => isNote(l) && normalise(l) === note.toLowerCase())) {
    return { ok: true, path, duplicate: true };
  }
  const body = existing.endsWith('\n') ? existing : `${existing}\n`;
  await writeFile(path, `${body}- ${note}\n`, 'utf-8');

  // A topic file is only found if the index points at it.
  if (file !== MEMORY_INDEX) {
    const indexPath = join(dir, MEMORY_INDEX);
    const index = (await readText(indexPath)) ?? header(input.scope);
    if (!index.includes(`(${file})`)) {
      const base = index.endsWith('\n') ? index : `${index}\n`;
      await writeFile(indexPath, `${base}- See [${input.topic}](${file})\n`, 'utf-8');
    }
  }
  return { ok: true, path };
}

/** Remove note lines containing `match` (case-insensitive). Returns how many went. */
export async function forgetMemory(
  input: { scope: MemoryScope; match: string; topic?: string },
  cwd: string = process.cwd(),
): Promise<{ removed: number; path: string }> {
  const path = join(memoryDir(input.scope, cwd), topicFile(input.topic));
  const text = await readText(path);
  const needle = input.match.trim().toLowerCase();
  if (!text || !needle) return { removed: 0, path };
  const lines = text.split('\n');
  const kept = lines.filter((l) => !(isNote(l) && l.toLowerCase().includes(needle)));
  const removed = lines.length - kept.length;
  if (removed > 0) await writeFile(path, kept.join('\n'), 'utf-8');
  return { removed, path };
}

export async function readMemory(
  input: { scope: MemoryScope; topic?: string },
  cwd: string = process.cwd(),
): Promise<{ path: string; text: string | null }> {
  const path = join(memoryDir(input.scope, cwd), topicFile(input.topic));
  return { path, text: await readText(path) };
}

export interface MemoryFile {
  scope: MemoryScope;
  name: string;
  path: string;
  notes: number;
}

export async function listMemory(cwd: string = process.cwd()): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  for (const scope of MEMORY_SCOPES) {
    const dir = memoryDir(scope, cwd);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const text = (await readText(join(dir, name))) ?? '';
      out.push({ scope, name, path: join(dir, name), notes: text.split('\n').filter(isNote).length });
    }
  }
  return out;
}

function capIndex(text: string): string {
  const all = text.trim();
  let body = all.split('\n').slice(0, INDEX_MAX_LINES).join('\n');
  if (body.length > INDEX_MAX_CHARS) body = body.slice(0, INDEX_MAX_CHARS);
  return body.length < all.length
    ? `${body}\n[index truncated; keep MEMORY.md short and move detail into topic files]`
    : body;
}

/** Topic files small enough to fit are inlined so the model needn't read them. */
const TOPIC_INLINE_CHARS = 6000;

async function inlineTopics(dir: string): Promise<string> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md') && n !== MEMORY_INDEX).sort();
  } catch {
    return '';
  }
  let budget = TOPIC_INLINE_CHARS;
  let out = '';
  for (const name of names) {
    const text = (await readText(join(dir, name)))?.trim();
    if (!text || text.length > budget) continue;
    budget -= text.length;
    out += `\n\n[${name}]\n${text}`;
  }
  return out;
}

const MEMORY_GUIDE = `Use the \`memory\` tool to keep notes that will help in later sessions:
- Save when the user corrects you, states a preference, or you learn something non-obvious about this project (build and test commands, conventions, gotchas, where things live). Save right away, in one short line.
- scope "repo" for facts about this project; scope "user" for the user's personal preferences across projects.
- Put detail under a topic (e.g. topic "testing") and keep MEMORY.md a short index. Small topic files are shown below; read larger ones with action "read" when relevant.
- Never save secrets, one-off task details, or what the repository instructions already say. Forget notes that turn out wrong.`;

/** The memory section of the system prompt. */
export async function memoryBlock(cwd: string = process.cwd()): Promise<string> {
  const parts: string[] = [];
  for (const scope of MEMORY_SCOPES) {
    const dir = memoryDir(scope, cwd);
    const text = await readText(join(dir, MEMORY_INDEX));
    if (text?.trim()) {
      const title = scope === 'repo' ? 'Project memory (scope "repo")' : 'Personal memory (scope "user")';
      parts.push(`### ${title}\n${capIndex(text)}${await inlineTopics(dir)}`);
    }
  }
  const body = parts.length > 0 ? parts.join('\n\n') : 'No memories saved yet.';
  return `\n\n## Memory\n${MEMORY_GUIDE}\n\n${body}`;
}
