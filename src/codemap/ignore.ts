import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ignore, { type Ignore } from 'ignore';

/**
 * Curated directories we always skip — build artifacts, cache dirs, vendor
 * dirs, the repo's own state. Patterns are written as gitignore lines so they
 * match at any depth (e.g. nested `node_modules/`).
 */
const IGNORED_DIRS = [
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
  '.bonfire',
] as const;

const IGNORED_FILE_BASENAMES = [
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
] as const;

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
  /** Combined gitignore-style matcher: curated defaults + project .gitignore. */
  matcher: Ignore;
  /** Lower-case extensions (incl. dot) treated as binary regardless of gitignore. */
  binaryExts: Set<string>;
}

export async function loadIgnoreRules(root: string): Promise<IgnoreRules> {
  const matcher = ignore();
  // Curated defaults — patterns are bare names, so they match at any depth.
  matcher.add(IGNORED_DIRS.map((d) => `${d}/`));
  matcher.add([...IGNORED_FILE_BASENAMES]);

  // Project-level .gitignore. We don't recurse into nested .gitignore files;
  // root coverage is enough for the 95% case and keeps the matcher simple.
  try {
    const raw = await readFile(resolve(root, '.gitignore'), 'utf-8');
    matcher.add(raw);
  } catch {
    // No .gitignore — fall back to curated defaults only.
  }

  return { matcher, binaryExts: BINARY_EXTENSIONS };
}

/** True if the given relative directory path should be skipped during walk. */
export function isIgnoredDir(relPath: string, rules: IgnoreRules): boolean {
  if (!relPath) return false;
  // Trailing slash makes the matcher treat the path as a directory.
  return rules.matcher.ignores(`${relPath}/`);
}

/** True if the given relative file path should be skipped during walk. */
export function isIgnoredFile(relPath: string, rules: IgnoreRules): boolean {
  if (!relPath) return false;
  if (rules.matcher.ignores(relPath)) return true;
  const lower = relPath.toLowerCase();
  for (const ext of rules.binaryExts) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}
