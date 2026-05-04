import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function getGlobalBonfireDir(): string {
  const home = homedir();
  const isWindows = process.platform === 'win32';
  const baseDir = isWindows
    ? process.env.APPDATA || resolve(home, 'AppData', 'Roaming')
    : resolve(home, '.config');
  return resolve(baseDir, 'bonfire');
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: 'global' | 'project';
  path: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/**
 * Tiny YAML-ish frontmatter parser. Supports only `key: value` pairs on
 * separate lines (no nesting, no arrays). Adequate for skill metadata.
 */
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, body: raw };
  const meta: Frontmatter = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key === 'name' || key === 'description') meta[key] = value;
  }
  return { meta, body: m[2].trim() };
}

async function readSkillsDir(
  dir: string,
  source: Skill['source'],
): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const path = resolve(dir, entry);
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      continue;
    }
    const { meta, body } = parseFrontmatter(raw);
    const fileBaseName = entry.slice(0, -3);
    skills.push({
      name: meta.name ?? fileBaseName,
      description: meta.description ?? '',
      body,
      source,
      path,
    });
  }
  return skills;
}

let cache: Skill[] | null = null;

/**
 * Discover skills from the global bonfire dir (OS-specific) and <cwd>/.bonfire/skills/ (project).
 * Project skills override global skills with the same name.
 */
export async function loadSkills(cwd: string = process.cwd()): Promise<Skill[]> {
  if (cache) return cache;
  const globalDir = getGlobalBonfireDir();
  const [global, project] = await Promise.all([
    readSkillsDir(resolve(globalDir, 'skills'), 'global'),
    readSkillsDir(resolve(cwd, '.bonfire', 'skills'), 'project'),
  ]);
  const merged = new Map<string, Skill>();
  for (const s of global) merged.set(s.name, s);
  for (const s of project) merged.set(s.name, s); // project wins on collision
  cache = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export async function findSkill(name: string, cwd?: string): Promise<Skill | null> {
  const all = await loadSkills(cwd);
  return all.find((s) => s.name === name) ?? null;
}

/** Reset the in-memory cache — used by /skills reload if we add it later. */
export function invalidateSkills() {
  cache = null;
}
