import { tool } from 'ai';
import { z } from 'zod';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPatch } from 'diff';
import { requestApproval } from './approval.js';
import { trackChange } from './changed-files.js';
import { safePath } from './safe-path.js';

async function readExisting(abs: string): Promise<string> {
  try {
    return await readFile(abs, 'utf-8');
  } catch {
    return '';
  }
}

export const readFileTool = tool({
  description: 'Read the contents of a file from the working directory.',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file'),
  }),
  execute: async ({ path }) => {
    const abs = await safePath(path);
    const content = await readFile(abs, 'utf-8');
    return { path, content };
  },
});

export const writeFileTool = tool({
  description:
    'Create or overwrite a file with the given content. Creates parent directories as needed.',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file'),
    content: z.string().describe('Full file content to write'),
  }),
  execute: async ({ path, content }) => {
    const abs = await safePath(path);
    const before = await readExisting(abs);
    const diff = createPatch(path, before, content, '', '');
    const decision = await requestApproval({ tool: 'write_file', path, diff });
    if (decision === 'no') return { path, status: 'skipped' };
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
    trackChange(path, 'write', content.length);
    return { path, bytes: content.length, status: 'written' };
  },
});

export const editFileTool = tool({
  description:
    'Edit a file by replacing an exact string. old_string must appear exactly once.',
  inputSchema: z.object({
    path: z.string(),
    old_string: z.string().describe('Exact text to find'),
    new_string: z.string().describe('Replacement text'),
  }),
  execute: async ({ path, old_string, new_string }) => {
    const abs = await safePath(path);
    const before = await readFile(abs, 'utf-8');
    const count = before.split(old_string).length - 1;
    if (count === 0) return { error: 'old_string not found' };
    if (count > 1) {
      return { error: `old_string appears ${count} times, must be unique` };
    }
    const updated = before.replace(old_string, new_string);
    const diff = createPatch(path, before, updated, '', '');
    const decision = await requestApproval({ tool: 'edit_file', path, diff });
    if (decision === 'no') return { path, status: 'skipped' };
    await writeFile(abs, updated, 'utf-8');
    trackChange(path, 'edit', updated.length);
    return { path, status: 'edited' };
  },
});

export const listDirTool = tool({
  description: 'List files and directories at a given path.',
  inputSchema: z.object({
    path: z.string().default('.'),
  }),
  execute: async ({ path }) => {
    const abs = await safePath(path);
    const entries = await readdir(abs);
    const items = await Promise.all(
      entries.map(async (name: string) => {
        const s = await stat(resolve(abs, name));
        return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size };
      }),
    );
    return { path, items };
  },
});
