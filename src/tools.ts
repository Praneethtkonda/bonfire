import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { execa } from 'execa';

const CWD = process.cwd();

function safePath(p: string): string {
  const abs = resolve(CWD, p);
  const rel = relative(CWD, abs);
  if (rel.startsWith('..')) {
    throw new Error(`Path ${p} is outside working directory`);
  }
  return abs;
}

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
    description: 'Create or overwrite a file with the given content. Creates parent directories as needed.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file'),
      content: z.string().describe('Full file content to write'),
    }),
    execute: async ({ path, content }) => {
      const abs = safePath(path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf-8');
      return { path, bytes: content.length, status: 'written' };
    },
  }),

  edit_file: tool({
    description: 'Edit a file by replacing an exact string. old_string must appear exactly once.',
    inputSchema: z.object({
      path: z.string(),
      old_string: z.string().describe('Exact text to find'),
      new_string: z.string().describe('Replacement text'),
    }),
    execute: async ({ path, old_string, new_string }) => {
      const abs = safePath(path);
      const content = await readFile(abs, 'utf-8');
      const count = content.split(old_string).length - 1;
      if (count === 0) return { error: 'old_string not found' };
      if (count > 1) return { error: `old_string appears ${count} times, must be unique` };
      const updated = content.replace(old_string, new_string);
      await writeFile(abs, updated, 'utf-8');
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

  bash: tool({
    description: 'Run a shell command in the working directory. Use for git, tests, builds, searches.',
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
