import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editFileTool,
  listDirTool,
  readFileTool,
  writeFileTool,
} from '../../src/tools/file-tools.js';
import { addAllowedDir } from '../../src/tools/safe-path.js';
import {
  setApprovalHandler,
  type ApprovalDecision,
} from '../../src/tools/approval.js';
import { resetRememberedApprovals } from '../../src/tools/remembered.js';

interface ExecTool<A> {
  execute?: (args: A, ctx?: unknown) => Promise<any>;
}
const e = <A>(t: unknown): ExecTool<A>['execute'] =>
  (t as ExecTool<A>).execute!;

let scratch: string;
let alwaysYes: () => void;
let alwaysNo: () => void;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'bonfire-file-tools-'));
  await addAllowedDir(scratch);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  setApprovalHandler(null);
});

beforeEach(() => {
  alwaysYes = () => setApprovalHandler(async () => 'yes' as ApprovalDecision);
  alwaysNo = () => setApprovalHandler(async () => 'no' as ApprovalDecision);
  setApprovalHandler(null);
});

describe('readFileTool', () => {
  it('returns the contents of an allowed file', async () => {
    const path = join(scratch, 'r1.txt');
    await writeFile(path, 'hello world', 'utf-8');
    const out = await e<{ path: string }>(readFileTool)!({ path });
    expect(out.content).toBe('hello world');
    expect(out.path).toBe(path);
  });

  it('rejects a path outside the allowlist', async () => {
    await expect(
      e<{ path: string }>(readFileTool)!({ path: '/etc/passwd' }),
    ).rejects.toThrow(/not in any allowed directory/);
  });
});

describe('writeFileTool', () => {
  it('writes a new file when approval = yes', async () => {
    alwaysYes();
    const path = join(scratch, 'sub', 'w1.txt');
    const out = await e<{ path: string; content: string }>(writeFileTool)!({
      path,
      content: 'fresh',
    });
    expect(out.status).toBe('written');
    expect(await readFile(path, 'utf-8')).toBe('fresh');
  });

  it('skips writing when approval = no', async () => {
    alwaysNo();
    const path = join(scratch, 'never.txt');
    const out = await e<{ path: string; content: string }>(writeFileTool)!({
      path,
      content: 'should-not-land',
    });
    expect(out.status).toBe('skipped');
    await expect(readFile(path, 'utf-8')).rejects.toBeTruthy();
  });

  it('overwrites an existing file with new content on approval', async () => {
    alwaysYes();
    const path = join(scratch, 'overwrite.txt');
    await writeFile(path, 'old', 'utf-8');
    await e<{ path: string; content: string }>(writeFileTool)!({
      path,
      content: 'new',
    });
    expect(await readFile(path, 'utf-8')).toBe('new');
  });
});

describe('editFileTool', () => {
  it('replaces a unique substring on approval', async () => {
    alwaysYes();
    const path = join(scratch, 'edit.ts');
    await writeFile(path, 'export const FOO = 1;\n', 'utf-8');
    const out = await e<{ path: string; old_string: string; new_string: string }>(
      editFileTool,
    )!({
      path,
      old_string: 'FOO = 1',
      new_string: 'BAR = 2',
    });
    expect(out.status).toBe('edited');
    expect(await readFile(path, 'utf-8')).toBe('export const BAR = 2;\n');
  });

  it('errors when the old_string is not found', async () => {
    alwaysYes();
    const path = join(scratch, 'edit-missing.ts');
    await writeFile(path, 'nothing here', 'utf-8');
    const out = await e<{ path: string; old_string: string; new_string: string }>(
      editFileTool,
    )!({
      path,
      old_string: 'absent',
      new_string: 'never',
    });
    expect(out.error).toMatch(/not found/);
  });

  it('errors when the old_string appears more than once', async () => {
    alwaysYes();
    const path = join(scratch, 'edit-dup.ts');
    await writeFile(path, 'foo foo foo', 'utf-8');
    const out = await e<{ path: string; old_string: string; new_string: string }>(
      editFileTool,
    )!({
      path,
      old_string: 'foo',
      new_string: 'bar',
    });
    expect(out.error).toMatch(/appears 3 times/);
  });

  it('skips edit when approval = no', async () => {
    alwaysNo();
    const path = join(scratch, 'edit-skip.ts');
    await writeFile(path, 'aaa', 'utf-8');
    const out = await e<{ path: string; old_string: string; new_string: string }>(
      editFileTool,
    )!({
      path,
      old_string: 'aaa',
      new_string: 'bbb',
    });
    expect(out.status).toBe('skipped');
    expect(await readFile(path, 'utf-8')).toBe('aaa');
  });
});

describe('listDirTool', () => {
  it('lists files and dirs with sizes/types', async () => {
    const dir = join(scratch, 'listme');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.txt'), 'aa', 'utf-8');
    await mkdir(join(dir, 'sub'));
    const out = await e<{ path: string }>(listDirTool)!({ path: dir });
    const byName = new Map(
      (out.items as Array<{ name: string; type: string; size: number }>).map(
        (i) => [i.name, i],
      ),
    );
    expect(byName.get('a.txt')?.type).toBe('file');
    expect(byName.get('a.txt')?.size).toBe(2);
    expect(byName.get('sub')?.type).toBe('dir');
  });

  it('rejects listing outside the allowlist', async () => {
    await expect(e<{ path: string }>(listDirTool)!({ path: '/etc' })).rejects.toThrow(
      /not in any allowed directory/,
    );
  });
});

describe('readFileTool paging and caps', () => {
  it('returns a line range for offset/limit', async () => {
    const path = join(scratch, 'paged.txt');
    await writeFile(path, ['one', 'two', 'three', 'four', 'five'].join('\n'), 'utf-8');
    const out = await e<{ path: string; offset?: number; limit?: number }>(readFileTool)!({
      path,
      offset: 2,
      limit: 2,
    });
    expect(out.content).toBe('two\nthree');
    expect(out.truncated).toBe(true);
  });

  it('reads to the end when only offset is given', async () => {
    const path = join(scratch, 'paged2.txt');
    await writeFile(path, ['a', 'b', 'c'].join('\n'), 'utf-8');
    const out = await e<{ path: string; offset?: number }>(readFileTool)!({ path, offset: 3 });
    expect(out.content).toBe('c');
  });

  it('truncates a very large file and explains how to page', async () => {
    const path = join(scratch, 'huge.txt');
    await writeFile(path, 'x'.repeat(300 * 1024), 'utf-8');
    const out = await e<{ path: string }>(readFileTool)!({ path });
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBeLessThan(300 * 1024);
    expect(out.note).toMatch(/offset\/limit/);
  });

  it('does not mark a small whole-file read as truncated', async () => {
    const path = join(scratch, 'small.txt');
    await writeFile(path, 'tiny', 'utf-8');
    const out = await e<{ path: string }>(readFileTool)!({ path });
    expect(out.truncated).toBe(false);
  });
});

describe('listDirTool caps', () => {
  it('caps the number of entries and reports truncation', async () => {
    const dir = join(scratch, 'many');
    await mkdir(dir, { recursive: true });
    await Promise.all(
      Array.from({ length: 1100 }, (_, i) => writeFile(join(dir, `f${i}.txt`), '', 'utf-8')),
    );
    const out = await e<{ path: string }>(listDirTool)!({ path: dir });
    expect(out.items.length).toBe(1000);
    expect(out.truncated).toBe(true);
  });
});

describe('remembered file approvals', () => {
  it('stops prompting after the user answers "always"', async () => {
    resetRememberedApprovals();
    let prompts = 0;
    setApprovalHandler(async () => {
      prompts++;
      return 'always' as ApprovalDecision;
    });
    const path = join(scratch, 'remember.txt');
    const write = e<{ path: string; content: string }>(writeFileTool)!;
    await write({ path, content: 'one' });
    await write({ path, content: 'two' });
    expect(prompts).toBe(1);
    expect(await readFile(path, 'utf-8')).toBe('two');
    resetRememberedApprovals();
  });
});
