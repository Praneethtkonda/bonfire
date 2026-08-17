import { tool } from 'ai';
import { z } from 'zod';
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPatch } from 'diff';

/** Byte ceiling for a single unpaged read_file call. */
const MAX_FILE_BYTES = 256_000;
/** Entry ceiling for a single list_dir call. */
const MAX_DIR_ENTRIES = 1_000;

/** Read the first `bytes` bytes of a file as UTF-8, without buffering the rest. */
async function readHead(abs: string, bytes: number): Promise<string> {
  const handle = await open(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}
import { requestApproval } from './approval.js';
import { isApprovalRemembered, rememberApproval } from './remembered.js';
import { trackChange } from './changed-files.js';
import { safePath } from './safe-path.js';

/**
 * Gate a file mutation on user approval, honouring a previous "always" for the
 * same path. Returns false when the user declined.
 */
async function approveFileChange(
  tool: 'write_file' | 'edit_file',
  path: string,
  diff: string,
): Promise<boolean> {
  if (isApprovalRemembered('file', path)) return true;
  const decision = await requestApproval({ tool, path, diff });
  if (decision === 'no') return false;
  if (decision === 'always') rememberApproval('file', path);
  return true;
}

async function readExisting(abs: string): Promise<string> {
  try {
    return await readFile(abs, 'utf-8');
  } catch {
    return '';
  }
}

export const readFileTool = tool({
  description:
    'Read the contents of a file from the working directory. Large files are truncated — pass offset/limit to page through them by line.',
  inputSchema: z.object({
    path: z.string().describe('Relative path to the file'),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based line number to start reading from'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of lines to return'),
  }),
  execute: async ({ path, offset, limit }) => {
    const abs = await safePath(path);

    const s = await stat(abs);
    if (!s.isFile()) return { error: `${path} is not a file` };

    // Guard the context window: an unbounded read of a bundle or a lockfile
    // used to be enough to blow the whole conversation.
    if (s.size > MAX_FILE_BYTES && offset === undefined && limit === undefined) {
      const head = await readHead(abs, MAX_FILE_BYTES);
      return {
        path,
        content: head,
        truncated: true,
        totalBytes: s.size,
        note: `file is ${s.size} bytes; showing the first ${head.length}. Use offset/limit to read specific lines, or search to locate what you need.`,
      };
    }

    const raw = await readFile(abs, 'utf-8');

    if (offset === undefined && limit === undefined) {
      return { path, content: raw, truncated: false, totalBytes: s.size };
    }

    const lines = raw.split('\n');
    const start = (offset ?? 1) - 1;
    const end = limit === undefined ? lines.length : start + limit;
    const slice = lines.slice(start, end);
    return {
      path,
      content: slice.join('\n'),
      startLine: start + 1,
      endLine: Math.min(end, lines.length),
      totalLines: lines.length,
      truncated: end < lines.length || start > 0,
    };
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
    if (!(await approveFileChange('write_file', path, diff))) {
      return { path, status: 'skipped' };
    }
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
    if (!(await approveFileChange('edit_file', path, diff))) {
      return { path, status: 'skipped' };
    }
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
    const shown = entries.slice(0, MAX_DIR_ENTRIES);
    const items = await Promise.all(
      shown.map(async (name: string) => {
        try {
          const s = await stat(resolve(abs, name));
          return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size };
        } catch {
          // Broken symlink or a race with a concurrent delete — report it
          // rather than failing the whole listing.
          return { name, type: 'unknown', size: 0 };
        }
      }),
    );
    return {
      path,
      items,
      truncated: entries.length > shown.length,
      totalEntries: entries.length,
    };
  },
});
