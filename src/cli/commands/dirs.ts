import { addAllowedDir, getAllowedDirs } from '../../tools/index.js';
import type { SlashCommand } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const dirsCommand: SlashCommand = {
  trigger: '/dirs',
  description: 'Show all currently-allowed directories',
  match: (input) => input === '/dirs',
  async run(ctx, input) {
    const dirs = getAllowedDirs();
    ctx.appendLines(
      { kind: 'user', text: input },
      {
        kind: 'assistant',
        text: `Allowed directories (${dirs.length}):\n${dirs
          .map((d, i) => `  ${i === 0 ? '*' : '+'} ${d}`)
          .join('\n')}`,
      },
    );
  },
};

export const addDirCommand: SlashCommand = {
  trigger: '/add-dir',
  description: 'Add a directory to the filesystem allowlist',
  usage: '/add-dir <path>',
  match: (input) => input.startsWith('/add-dir '),
  async run(ctx, input) {
    const arg = input.slice('/add-dir '.length).trim();
    try {
      const added = await addAllowedDir(arg);
      ctx.appendLines(
        { kind: 'user', text: input },
        { kind: 'assistant', text: `Added allowed directory: ${added}` },
      );
    } catch (e: unknown) {
      ctx.appendLines(
        { kind: 'user', text: input },
        { kind: 'error', text: errorMessage(e) },
      );
    }
  },
};
