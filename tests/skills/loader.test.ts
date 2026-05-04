import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Loader reads `homedir()` from 'node:os'. Hoisted mock keeps a mutable ref
// so each test can swap in a fresh scratch home.
const mockHome = { value: '' };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mockHome.value };
});

const { findSkill, invalidateSkills, loadSkills } = await import(
  '../../src/skills/loader.js'
);

let cwdScratch: string;
let homeScratch: string;

beforeEach(async () => {
  cwdScratch = await mkdtemp(join(tmpdir(), 'bonfire-skills-cwd-'));
  homeScratch = await mkdtemp(join(tmpdir(), 'bonfire-skills-home-'));
  mockHome.value = homeScratch;
  invalidateSkills();
});

afterEach(async () => {
  invalidateSkills();
  await rm(cwdScratch, { recursive: true, force: true });
  await rm(homeScratch, { recursive: true, force: true });
});

async function plantSkill(
  base: string,
  filename: string,
  body: string,
): Promise<void> {
  const dir = join(base, '.bonfire', 'skills');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), body, 'utf-8');
}

describe('loadSkills', () => {
  it('returns empty when no skills directories exist', async () => {
    expect(await loadSkills(cwdScratch)).toEqual([]);
  });

  it('parses YAML-ish frontmatter with name + description', async () => {
    await plantSkill(
      cwdScratch,
      'api.md',
      `---
name: api-endpoint
description: Add a new HTTP endpoint
---

Step 1. Do the thing.
Step 2. Test it.`,
    );
    const skills = await loadSkills(cwdScratch);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('api-endpoint');
    expect(skills[0].description).toBe('Add a new HTTP endpoint');
    expect(skills[0].body).toContain('Step 1.');
    expect(skills[0].body).toContain('Step 2.');
    expect(skills[0].source).toBe('project');
  });

  it('falls back to filename (no extension) when name is missing', async () => {
    await plantSkill(cwdScratch, 'no-name.md', '---\ndescription: x\n---\nbody');
    const skills = await loadSkills(cwdScratch);
    expect(skills[0].name).toBe('no-name');
  });

  it('skips non-.md files', async () => {
    const dir = join(cwdScratch, '.bonfire', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'not-a-skill.txt'), 'noise', 'utf-8');
    expect(await loadSkills(cwdScratch)).toEqual([]);
  });

  it('handles a skill file with no frontmatter as body-only', async () => {
    await plantSkill(cwdScratch, 'plain.md', 'just instructions, no header');
    const skills = await loadSkills(cwdScratch);
    expect(skills[0].name).toBe('plain');
    expect(skills[0].description).toBe('');
    expect(skills[0].body).toBe('just instructions, no header');
  });

  it('strips quotes around frontmatter values', async () => {
    await plantSkill(
      cwdScratch,
      'quoted.md',
      `---\nname: "quoted-name"\ndescription: 'with apostrophes'\n---\nbody`,
    );
    const skills = await loadSkills(cwdScratch);
    expect(skills[0].name).toBe('quoted-name');
    expect(skills[0].description).toBe('with apostrophes');
  });

  it('merges global + project skills, project wins on collision', async () => {
    await plantSkill(homeScratch, 'shared.md', '---\nname: shared\ndescription: GLOBAL\n---\nglobal-body');
    await plantSkill(cwdScratch, 'shared.md', '---\nname: shared\ndescription: PROJECT\n---\nproject-body');
    await plantSkill(homeScratch, 'global-only.md', '---\nname: global-only\ndescription: g\n---\nbody');

    const skills = await loadSkills(cwdScratch);
    const byName = new Map(skills.map((s) => [s.name, s]));
    expect(byName.get('shared')?.description).toBe('PROJECT');
    expect(byName.get('shared')?.source).toBe('project');
    expect(byName.get('global-only')?.source).toBe('global');
  });

  it('caches results across calls until invalidated', async () => {
    await plantSkill(cwdScratch, 'a.md', '---\nname: a\ndescription: x\n---\nbody');
    const first = await loadSkills(cwdScratch);
    await plantSkill(cwdScratch, 'b.md', '---\nname: b\ndescription: y\n---\nbody');
    const second = await loadSkills(cwdScratch);
    expect(second).toBe(first); // cache hit
    expect(second.map((s) => s.name)).toEqual(['a']);
    invalidateSkills();
    const third = await loadSkills(cwdScratch);
    expect(third.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('returns skills sorted alphabetically by name', async () => {
    await plantSkill(cwdScratch, 'beta.md', '---\nname: beta\ndescription: x\n---\nbody');
    await plantSkill(cwdScratch, 'alpha.md', '---\nname: alpha\ndescription: x\n---\nbody');
    const skills = await loadSkills(cwdScratch);
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'beta']);
  });
});

describe('findSkill', () => {
  it('returns the skill by exact name', async () => {
    await plantSkill(cwdScratch, 'one.md', '---\nname: one\ndescription: x\n---\nbody');
    const skill = await findSkill('one', cwdScratch);
    expect(skill?.body).toBe('body');
  });

  it('returns null when not found', async () => {
    expect(await findSkill('nope', cwdScratch)).toBeNull();
  });
});
