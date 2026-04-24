import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { execa } from 'execa';
import { createPatch } from 'diff';

const CWD = process.cwd();
const allowedDirs: string[] = [CWD];

export function getAllowedDirs(): readonly string[] {
  return allowedDirs;
}

export async function addAllowedDir(p: string): Promise<string> {
  const abs = resolve(CWD, p);
  const s = await stat(abs);
  if (!s.isDirectory()) throw new Error(`${abs} is not a directory`);
  if (!allowedDirs.includes(abs)) allowedDirs.push(abs);
  return abs;
}

function safePath(p: string): string {
  const abs = resolve(CWD, p);
  for (const dir of allowedDirs) {
    if (abs === dir || abs.startsWith(dir + sep)) return abs;
  }
  throw new Error(
    `Path ${p} is not in any allowed directory. Use /add-dir <path> to allow it.`
  );
}

export type ApprovalRequest = {
  tool: 'write_file' | 'edit_file';
  path: string;
  diff: string;
};

let approvalHandler:
  | ((req: ApprovalRequest) => Promise<boolean>)
  | null = null;

/**
 * Sets the handler for approval requests.
 * @param fn - The approval handler function, or null to disable approval
 */
export function setApprovalHandler(
  fn: ((req: ApprovalRequest) => Promise<boolean>) | null
) {
  approvalHandler = fn;
}

async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (!approvalHandler) return true;
  return approvalHandler(req);
}

export type FileChange = { writes: number; edits: number; bytes: number };
export const changedFiles = new Map<string, FileChange>();

function trackChange(path: string, kind: 'write' | 'edit', bytes: number) {
  const prev = changedFiles.get(path) ?? { writes: 0, edits: 0, bytes: 0 };
  if (kind === 'write') prev.writes += 1;
  else prev.edits += 1;
  prev.bytes = bytes;
  changedFiles.set(path, prev);
}

async function readExisting(abs: string): Promise<string> {
  try {
    return await readFile(abs, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Collection of AI tools for file and shell operations.
 */
export const tools = {
  read_file: tool({
    description: 'Read the contents of a file from the working directory.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file'),
    }),
    execute: async ({ path }) => {
      const abs = safePath(path);
      const content = await readFile(abs, 'utf-8');
      return { path, content };
    },
  }),

  write_file: tool({
    description:
      'Create or overwrite a file with the given content. Creates parent directories as needed.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file'),
      content: z.string().describe('Full file content to write'),
    }),
    execute: async ({ path, content }) => {
      const abs = safePath(path);
      const before = await readExisting(abs);
      const diff = createPatch(path, before, content, '', '');
      const ok = await requestApproval({ tool: 'write_file', path, diff });
      if (!ok) return { path, status: 'skipped' };
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf-8');
      trackChange(path, 'write', content.length);
      return { path, bytes: content.length, status: 'written' };
    },
  }),

  edit_file: tool({
    description:
      'Edit a file by replacing an exact string. old_string must appear exactly once.',
    inputSchema: z.object({
      path: z.string(),
      old_string: z.string().describe('Exact text to find'),
      new_string: z.string().describe('Replacement text'),
    }),
    execute: async ({ path, old_string, new_string }) => {
      const abs = safePath(path);
      const before = await readFile(abs, 'utf-8');
      const count = before.split(old_string).length - 1;
      if (count === 0) return { error: 'old_string not found' };
      if (count > 1)
        return { error: `old_string appears ${count} times, must be unique` };
      const updated = before.replace(old_string, new_string);
      const diff = createPatch(path, before, updated, '', '');
      const ok = await requestApproval({ tool: 'edit_file', path, diff });
      if (!ok) return { path, status: 'skipped' };
      await writeFile(abs, updated, 'utf-8');
      trackChange(path, 'edit', updated.length);
      return { path, status: 'edited' };
    },
  }),

  list_dir: tool({
    description: 'List files and directories at a given path.',
    inputSchema: z.object({
      path: z.string().default('.'),
    }),
    execute: async ({ path }) => {
      const abs = safePath(path);
      const entries = await readdir(abs);
      const items = await Promise.all(
        entries.map(async (name: string) => {
          const s = await stat(resolve(abs, name));
          return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size };
        })
      );
      return { path, items };
    },
  }),

  shell: tool({
    description:
      'Run a shell command in the working directory. Uses /bin/sh on Unix and cmd.exe on Windows. Use for git, tests, builds, searches.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
    }),
    execute: async ({ command }) => {
      try {
        const { stdout, stderr, exitCode } = await execa(command, {
          shell: true,
          cwd: CWD,
          timeout: 60_000,
          reject: false,
        });
        return {
          exitCode,
          stdout: stdout.slice(0, 8000),
          stderr: stderr.slice(0, 2000),
        };
      } catch (e: any) {
        return { error: e.message };
      }
    },
  }),
};
