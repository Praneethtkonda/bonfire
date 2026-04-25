import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Default ignore patterns — directory names, file basenames, and extensions.
// Kept conservative: noise directories + lockfiles + binary assets.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  'coverage',
  '.nyc_output',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.idea',
  '.vscode',
  '.DS_Store',
  '.nano',
]);

const IGNORED_FILE_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
  '.DS_Store',
]);

const BINARY_EXTENSIONS = new Set([
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.svg',
  // av
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac', '.ogg', '.webm',
  // archives
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar', '.xz',
  // docs
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // binaries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.wasm',
  // misc
  '.map', '.min.js', '.min.css',
]);

export interface IgnoreRules {
  /** Exact basenames of dirs to skip. */
  dirs: Set<string>;
  /** Exact basenames of files to skip. */
  files: Set<string>;
  /** Lower-case extensions (incl. dot) to treat as binary/skip. */
  binaryExts: Set<string>;
  /** Simple glob-ish patterns from .gitignore (basename matches only, for prototype). */
  gitignorePatterns: string[];
}

export async function loadIgnoreRules(root: string): Promise<IgnoreRules> {
  const gitignorePatterns = await readGitignore(root);
  return {
    dirs: IGNORED_DIRS,
    files: IGNORED_FILE_BASENAMES,
    binaryExts: BINARY_EXTENSIONS,
    gitignorePatterns,
  };
}

async function readGitignore(root: string): Promise<string[]> {
  try {
    const raw = await readFile(resolve(root, '.gitignore'), 'utf-8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Cheap basename-oriented match against .gitignore lines.
 * Full glob semantics are out of scope for the prototype — the default
 * directory/extension lists already cover the 90% case. We just check
 * plain-name and `name/` patterns as an extra safety net.
 */
export function matchesGitignoreBasename(name: string, patterns: string[]): boolean {
  for (const p of patterns) {
    const stripped = p.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!stripped || stripped.includes('/') || stripped.includes('*')) continue;
    if (stripped === name) return true;
  }
  return false;
}

export function isIgnoredDir(name: string, rules: IgnoreRules): boolean {
  if (rules.dirs.has(name)) return true;
  if (name.startsWith('.') && name !== '.') {
    // hidden dirs are skipped by default except explicitly allowed ones
    return true;
  }
  return matchesGitignoreBasename(name, rules.gitignorePatterns);
}

export function isIgnoredFile(name: string, rules: IgnoreRules): boolean {
  if (rules.files.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ext of rules.binaryExts) {
    if (lower.endsWith(ext)) return true;
  }
  return matchesGitignoreBasename(name, rules.gitignorePatterns);
}
