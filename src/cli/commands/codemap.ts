import { buildSummaries, ensureCodemap, rebuildCodemap, statsFor } from '../../codemap/index.js';
import type { SlashCommand } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const codemapCommand: SlashCommand = {
  trigger: '/codemap',
  description: 'Inspect / build the repo codemap',
  usage: '/codemap [build|rebuild|status]',
  subcommands: [
    { name: 'status', description: 'Show file/dir/summary counts (default)' },
    { name: 'build', description: 'Run the LLM summarization pass' },
    { name: 'rebuild', description: 'Re-walk and re-summarize from scratch' },
  ],
  match: (input) => input === '/codemap' || input.startsWith('/codemap '),
  async run(ctx, input) {
    const sub = input.slice('/codemap'.length).trim();
    ctx.appendLines({ kind: 'user', text: input });
    try {
      if (sub === '' || sub === 'status') {
        const map = await ensureCodemap(ctx.cwd);
        const s = statsFor(map);
        ctx.appendLines({
          kind: 'assistant',
          text: `codemap · ${s.files} files · ${s.dirs} dirs · ${s.summarized}/${
            s.files + s.dirs
          } summarized · ${(s.bytes / 1024).toFixed(0)} KB indexed`,
        });
        return;
      }
      if (sub === 'build' || sub === 'rebuild') {
        const controller = new AbortController();
        ctx.registerAbort(() => controller.abort());
        ctx.setBusy(true);
        try {
          if (sub === 'rebuild') await rebuildCodemap(ctx.cwd);
          ctx.setCodemapProgress({ done: 0, total: 0, path: 'starting' });
          const map = await buildSummaries(ctx.cwd, {
            force: sub === 'rebuild',
            signal: controller.signal,
            onProgress: (done, total, path) =>
              ctx.setCodemapProgress({ done, total, path }),
          });
          const s = statsFor(map);
          ctx.appendLines({
            kind: controller.signal.aborted ? 'error' : 'assistant',
            text: controller.signal.aborted
              ? `codemap ${sub} aborted · summarized ${s.summarized} nodes so far`
              : `codemap ${sub} complete · summarized ${s.summarized} nodes`,
          });
        } finally {
          ctx.setCodemapProgress(null);
          ctx.setBusy(false);
          ctx.registerAbort(null);
        }
        return;
      }
      ctx.appendLines({
        kind: 'error',
        text: `unknown /codemap subcommand: ${sub}. Use /codemap, /codemap build, or /codemap rebuild.`,
      });
    } catch (e: unknown) {
      ctx.setCodemapProgress(null);
      ctx.setBusy(false);
      ctx.registerAbort(null);
      ctx.appendLines({ kind: 'error', text: errorMessage(e) });
    }
  },
};
