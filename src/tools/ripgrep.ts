import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BINARY_EXTENSIONS, IGNORED_DIRS, IGNORED_FILE_BASENAMES } from '../codemap/ignore.js';

/**
 * ripgrep fast path for the search tool. Used when `rg` is installed
 * (or BONFIRE_RG points at it); the caller falls back to the built-in
 * walk when it isn't, or when rg rejects the pattern (its regex dialect has
 * no look-around).
 */

export interface RgMatch {
  path: string;
  line: number;
  text: string;
}

export interface RgOutcome {
  matches: RgMatch[];
  filesScanned: number;
  truncated: boolean;
}

let cached: string | null | undefined;

export function findRipgrep(): string | null {
  if (process.env.BONFIRE_NO_RG === '1') return null;
  if (cached !== undefined) return cached;
  const candidate = process.env.BONFIRE_RG || 'rg';
  const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 3_000 });
  cached = probe.status === 0 ? candidate : null;
  return cached;
}

export function resetRipgrepCache(): void {
  cached = undefined;
}

export function ripgrepArgs(input: { pattern: string; glob?: string; caseSensitive?: boolean }): string[] {
  const args = [
    '--json',
    '--no-config',
    '--hidden',
    '--no-require-git',
    '--sort',
    'path',
    '--max-filesize',
    '2M',
    input.caseSensitive ? '--case-sensitive' : '--ignore-case',
  ];
  for (const d of IGNORED_DIRS) args.push('--glob', `!${d}/`);
  for (const f of IGNORED_FILE_BASENAMES) args.push('--glob', `!${f}`);
  for (const ext of BINARY_EXTENSIONS) args.push('--glob', `!*${ext}`);
  if (input.glob) args.push('--glob', input.glob);
  args.push('-e', input.pattern, '--', '.');
  return args;
}

interface RgEvent {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    stats?: { searches?: number };
  };
}

/** Run rg under `root`. Resolves null when rg fails, so the caller can fall back. */
export function searchWithRipgrep(
  rg: string,
  root: string,
  input: { pattern: string; glob?: string; caseSensitive?: boolean },
  cap: number,
  maxLineChars: number,
): Promise<RgOutcome | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(rg, ripgrepArgs(input), { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    const matches: RgMatch[] = [];
    const files = new Set<string>();
    let searches: number | undefined;
    let truncated = false;
    let settled = false;
    const finish = (value: RgOutcome | null) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };

    createInterface({ input: child.stdout }).on('line', (line) => {
      if (truncated) return;
      let ev: RgEvent;
      try {
        ev = JSON.parse(line) as RgEvent;
      } catch {
        return;
      }
      if (ev.type === 'summary') searches = ev.data?.stats?.searches;
      if (ev.type !== 'match' || !ev.data?.path?.text) return;
      const path = ev.data.path.text.replace(/^\.\//, '');
      const text = (ev.data.lines?.text ?? '').replace(/\r?\n$/, '').trimEnd();
      files.add(path);
      matches.push({
        path,
        line: ev.data.line_number ?? 0,
        text: text.length > maxLineChars ? `${text.slice(0, maxLineChars)}…` : text,
      });
      if (matches.length >= cap) {
        truncated = true;
        child.kill();
      }
    });

    child.on('error', () => finish(null));
    child.on('close', (code) => {
      // 0 = matches, 1 = none, 2 = error (bad regex, etc.). A kill after the
      // cap is a success.
      if (!truncated && code !== 0 && code !== 1) return finish(null);
      finish({ matches, filesScanned: searches ?? files.size, truncated });
    });
  });
}
