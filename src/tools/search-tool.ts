import { tool } from 'ai';
import { z } from 'zod';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { isIgnoredDir, isIgnoredFile, loadIgnoreRules } from '../codemap/ignore.js';
import { safePath, getCwd } from './safe-path.js';

const MAX_MATCHES = 200;
const MAX_FILES_SCANNED = 20_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_LINE_CHARS = 400;

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchOutcome {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
  error?: string;
}

/**
 * Convert a simple glob (`*.ts`, `src/**\/*.test.ts`) to a RegExp matched
 * against the repo-relative, forward-slashed path.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` spans directories (including zero of them); bare `**` is any run.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A bare pattern with no slash matches at any depth, like gitignore.
  const body = glob.includes('/') ? out : `(?:.*/)?${out}`;
  return new RegExp(`^${body}$`);
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** True when the buffer looks binary (NUL byte in the first 8 KB). */
function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true;
  return false;
}

export async function searchRepo(input: {
  pattern: string;
  root?: string;
  glob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
}): Promise<SearchOutcome> {
  const root = input.root ?? getCwd();
  const cap = Math.min(input.maxMatches ?? MAX_MATCHES, MAX_MATCHES);

  let re: RegExp;
  try {
    re = new RegExp(input.pattern, input.caseSensitive ? 'g' : 'gi');
  } catch (e: unknown) {
    return {
      matches: [],
      filesScanned: 0,
      truncated: false,
      error: `invalid regex: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const globRe = input.glob ? globToRegExp(input.glob) : null;
  const rules = await loadIgnoreRules(root);

  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const queue: string[] = [''];
  while (queue.length > 0) {
    if (matches.length >= cap || filesScanned >= MAX_FILES_SCANNED) {
      truncated = true;
      break;
    }
    const rel = queue.shift()!;
    const abs = rel ? resolve(root, rel) : root;

    let entries: string[];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }

    for (const name of entries) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = resolve(abs, name);
      let s;
      try {
        s = await stat(childAbs);
      } catch {
        continue;
      }

      if (s.isDirectory()) {
        if (!isIgnoredDir(childRel, rules)) queue.push(childRel);
        continue;
      }
      if (!s.isFile()) continue;
      if (isIgnoredFile(childRel, rules)) continue;
      if (globRe && !globRe.test(childRel)) continue;
      if (s.size > MAX_FILE_BYTES) continue;

      let buf: Buffer;
      try {
        buf = await readFile(childAbs);
      } catch {
        continue;
      }
      if (looksBinary(buf)) continue;
      filesScanned++;

      const lines = buf.toString('utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (!re.test(lines[i])) continue;
        const text = lines[i].trimEnd();
        matches.push({
          path: toPosix(childRel),
          line: i + 1,
          text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text,
        });
        if (matches.length >= cap) {
          truncated = true;
          break;
        }
      }
      if (matches.length >= cap) break;
    }
  }

  return { matches, filesScanned, truncated };
}

export const searchTool = tool({
  description:
    'Search file contents across the repo with a regular expression. Honours .gitignore, skips binaries and build output. Prefer this over shelling out to grep/findstr — it is faster and works identically on every platform. Returns path, line number and the matching line.',
  inputSchema: z.object({
    pattern: z.string().describe('JavaScript regular expression to search for'),
    glob: z
      .string()
      .optional()
      .describe('Optional file filter, e.g. "*.ts" or "src/**/*.test.ts"'),
    path: z
      .string()
      .default('.')
      .describe('Directory to search under, relative to the repo root'),
    case_sensitive: z.boolean().default(false),
    max_matches: z.number().int().positive().default(100),
  }),
  execute: async ({ pattern, glob, path, case_sensitive, max_matches }) => {
    const root = await safePath(path);
    const result = await searchRepo({
      pattern,
      root,
      glob,
      caseSensitive: case_sensitive,
      maxMatches: max_matches,
    });
    if (result.error) return { error: result.error };
    return {
      pattern,
      matchCount: result.matches.length,
      filesScanned: result.filesScanned,
      truncated: result.truncated,
      matches: result.matches.map((m) => ({
        // Report paths relative to cwd so they can be fed straight to read_file.
        path: toPosix(relative(getCwd(), resolve(root, m.path))) || m.path,
        line: m.line,
        text: m.text,
      })),
    };
  },
});
