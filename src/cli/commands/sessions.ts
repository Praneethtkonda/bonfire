import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
} from '../../session/index.js';
import type { SlashCommand } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const sessionsCommand: SlashCommand = {
  trigger: '/sessions',
  description: 'List, save, load, and delete saved sessions',
  usage: '/sessions [list|new|load <id>|save|delete <id>]',
  subcommands: [
    { name: 'list', description: 'Show saved sessions (default)' },
    { name: 'new', description: 'Start a new empty session' },
    { name: 'load', description: 'Restore a session by ID — /sessions load <id>' },
    { name: 'save', description: 'Force-save the active session' },
    { name: 'delete', description: 'Delete a session by ID — /sessions delete <id>' },
  ],
  match: (input) => input === '/sessions' || input.startsWith('/sessions '),
  async run(ctx, input) {
    const sub = input.slice('/sessions'.length).trim();
    ctx.appendLines({ kind: 'user', text: input });
    try {
      if (sub === '' || sub === 'list' || sub === 'ls') {
        await handleList(ctx);
        return;
      }
      if (sub === 'new') {
        await handleNew(ctx);
        return;
      }
      if (sub.startsWith('load ') || sub.startsWith('open ')) {
        await handleLoad(ctx, sub);
        return;
      }
      if (sub === 'save') {
        await handleSave(ctx);
        return;
      }
      if (sub.startsWith('delete ') || sub.startsWith('rm ')) {
        await handleDelete(ctx, sub);
        return;
      }
      ctx.appendLines({
        kind: 'error',
        text: `Unknown /sessions subcommand: ${sub}. Use list, new, load <id>, save, delete <id>.`,
      });
    } catch (e: unknown) {
      ctx.appendLines({ kind: 'error', text: errorMessage(e) });
    }
  },
};

async function handleList(ctx: import('./types.js').CommandContext) {
  const metas = await listSessions(ctx.cwd);
  if (metas.length === 0) {
    ctx.appendLines({
      kind: 'assistant',
      text: 'No saved sessions yet. Create one with /sessions new.',
    });
    return;
  }
  const currentId = ctx.currentSession?.id;
  const lines = metas.map((m) => {
    const mark = m.id === currentId ? '▸' : ' ';
    const date = new Date(m.updatedAt).toLocaleString();
    const summary = `${m.turnCount} turns · ${m.provider}`;
    const last = m.lastMessage ? ` · "${m.lastMessage}"` : '';
    return `${mark} ${m.id}  ${date}  ${summary}${last}`;
  });
  ctx.appendLines({
    kind: 'assistant',
    text: `Sessions (${metas.length}):\n${lines.join(
      '\n',
    )}\n\n/sessions load <id> · /sessions save · /sessions delete <id>`,
  });
}

async function handleNew(ctx: import('./types.js').CommandContext) {
  const session = await createSession(ctx.cwd, {
    cwd: ctx.cwd,
    provider: ctx.providerLabel,
  });
  ctx.setCurrentSession(session);
  ctx.setHistory([]);
  ctx.appendLines({
    kind: 'assistant',
    text: `New session ${session.id} created (cwd: ${ctx.cwd})`,
  });
}

async function handleLoad(ctx: import('./types.js').CommandContext, sub: string) {
  const id = sub.split(/\s+/)[1];
  if (!id) {
    ctx.appendLines({ kind: 'error', text: 'Usage: /sessions load <id>' });
    return;
  }
  const session = await loadSession(ctx.cwd, id);
  if (!session) {
    ctx.appendLines({ kind: 'error', text: `Session "${id}" not found` });
    return;
  }
  ctx.setCurrentSession(session);
  ctx.setHistory(session.history);
  ctx.appendLines({
    kind: 'assistant',
    text: `Loaded session ${session.id} · ${session.history.length} messages · cwd: ${session.cwd}`,
  });
}

async function handleSave(ctx: import('./types.js').CommandContext) {
  if (!ctx.currentSession) {
    ctx.appendLines({
      kind: 'error',
      text: 'No active session to save. Create one with /sessions new.',
    });
    return;
  }
  await saveSession(ctx.cwd, ctx.currentSession);
  ctx.appendLines({
    kind: 'assistant',
    text: `Session ${ctx.currentSession.id} saved.`,
  });
}

async function handleDelete(ctx: import('./types.js').CommandContext, sub: string) {
  const id = sub.split(/\s+/)[1];
  if (!id) {
    ctx.appendLines({ kind: 'error', text: 'Usage: /sessions delete <id>' });
    return;
  }
  const ok = await deleteSession(ctx.cwd, id);
  if (ok) {
    ctx.appendLines({ kind: 'assistant', text: `Session ${id} deleted.` });
  } else {
    ctx.appendLines({ kind: 'error', text: `Session "${id}" not found` });
  }
}
