import type { SlashCommand } from './types.js';
import { listMemory, memoryDir, saveMemory, type MemoryScope } from '../../memory/index.js';

async function remember(ctx: Parameters<SlashCommand['run']>[0], scope: MemoryScope, note: string) {
  const r = await saveMemory({ scope, note }, ctx.cwd);
  ctx.appendLines(
    r.ok
      ? {
          kind: 'notice',
          text: r.duplicate ? `already remembered · ${r.path}` : `remembered (${scope}) · ${r.path}`,
        }
      : { kind: 'error', text: `not saved: ${r.error}` },
  );
}

export const memoryCommand: SlashCommand = {
  trigger: '/memory',
  description: 'Show the memory files bonfire keeps for this repo and for you',
  match: (input) => input.trim() === '/memory',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    const files = await listMemory(ctx.cwd);
    const lines = ['Memory'];
    for (const scope of ['repo', 'user'] as MemoryScope[]) {
      lines.push('', `  ${scope === 'repo' ? 'repo' : 'user'}  ${memoryDir(scope, ctx.cwd)}`);
      const mine = files.filter((f) => f.scope === scope);
      if (mine.length === 0) lines.push('        (empty)');
      for (const f of mine) lines.push(`        ${f.name}  ${f.notes} note${f.notes === 1 ? '' : 's'}`);
    }
    lines.push(
      '',
      'Edit the files directly to change or remove notes.',
      'Add one: /remember <note> (this repo) · /remember --user <note> (all repos) · or start a message with #',
    );
    ctx.appendLines({ kind: 'assistant', text: lines.join('\n') });
  },
};

export const rememberCommand: SlashCommand = {
  trigger: '/remember',
  usage: '/remember [--user] <note>',
  description: 'Save a note to memory (this repo, or --user for all repos)',
  match: (input) => /^\/remember(\s|$)/.test(input.trim()),
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    let rest = input.trim().replace(/^\/remember\s*/, '');
    let scope: MemoryScope = 'repo';
    if (/^--user(\s|$)/.test(rest)) {
      scope = 'user';
      rest = rest.replace(/^--user\s*/, '');
    }
    if (!rest) {
      ctx.appendLines({ kind: 'error', text: 'usage: /remember [--user] <note>' });
      return;
    }
    await remember(ctx, scope, rest);
  },
};

/** `# note` saves to this repo's memory, like Claude Code's shortcut. */
export const hashMemoryCommand: SlashCommand = {
  trigger: '#',
  usage: '# <note>',
  description: 'Quick-save a note to this repo’s memory',
  match: (input) => /^#\s+\S/.test(input.trim()),
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    await remember(ctx, 'repo', input.trim().replace(/^#\s+/, ''));
  },
};
