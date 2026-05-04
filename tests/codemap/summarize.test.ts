import { describe, expect, it } from 'vitest';
import { pickDirChildrenForPrompt } from '../../src/codemap/summarize.js';
import type { CodemapNode } from '../../src/codemap/types.js';

function file(name: string, opts: Partial<CodemapNode> = {}): CodemapNode {
  return {
    path: name,
    name,
    kind: 'file',
    skeleton: `skeleton for ${name}`,
    size: 100,
    mtime: 0,
    ...opts,
  };
}

function dir(name: string, opts: Partial<CodemapNode> = {}): CodemapNode {
  return {
    path: name,
    name,
    kind: 'dir',
    skeleton: `dir skeleton for ${name}`,
    children: [],
    ...opts,
  };
}

describe('pickDirChildrenForPrompt', () => {
  it('always renders every subdirectory', async () => {
    const node = dir('parent', {
      children: [
        dir('a'),
        dir('b'),
        dir('c'),
        ...Array.from({ length: 30 }, (_, i) => file(`f${i}.ts`)),
      ],
    });
    const { lines } = pickDirChildrenForPrompt(node);
    const dirLines = lines.filter((l) => l.startsWith('- [dir]'));
    expect(dirLines.map((l) => l.split(' ')[2])).toEqual(['a', 'b', 'c']);
  });

  it('caps files per extension and reports overflow', async () => {
    const tsFiles = Array.from({ length: 12 }, (_, i) =>
      file(`t${i}.ts`, { size: 1000 - i }),
    );
    const node = dir('parent', { children: tsFiles });
    const { lines } = pickDirChildrenForPrompt(node);
    const fileLines = lines.filter((l) => l.startsWith('- [file]'));
    expect(fileLines).toHaveLength(6); // MAX_FILES_PER_EXT
    const overflowLine = lines.find((l) => l.startsWith('- ...and'));
    expect(overflowLine).toBeDefined();
    expect(overflowLine).toContain('6 more .ts');
  });

  it('groups overflow per extension', async () => {
    const node = dir('parent', {
      children: [
        ...Array.from({ length: 10 }, (_, i) => file(`a${i}.ts`)),
        ...Array.from({ length: 10 }, (_, i) => file(`b${i}.md`)),
      ],
    });
    const { lines } = pickDirChildrenForPrompt(node);
    const overflow = lines.find((l) => l.startsWith('- ...and'))!;
    expect(overflow).toContain('4 more .ts');
    expect(overflow).toContain('4 more .md');
  });

  it('marks unsummarized children with (unsummarized) instead of leaking the skeleton', async () => {
    const node = dir('parent', {
      children: [file('failed.ts', { summaryFailedAt: Date.now() })],
    });
    const { lines } = pickDirChildrenForPrompt(node);
    expect(lines[0]).toContain('(unsummarized)');
    expect(lines[0]).not.toContain('skeleton for failed.ts');
  });

  it('uses the summary when present, falling back to skeleton when neither summary nor failure', async () => {
    const summarized = file('s.ts', { summary: 'real summary' });
    const skeletonOnly = file('k.ts');
    const node = dir('parent', { children: [summarized, skeletonOnly] });
    const { lines } = pickDirChildrenForPrompt(node);
    expect(lines.find((l) => l.includes('s.ts'))).toContain('real summary');
    expect(lines.find((l) => l.includes('k.ts'))).toContain('skeleton for k.ts');
  });
});
