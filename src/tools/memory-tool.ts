import { tool } from 'ai';
import { z } from 'zod';
import { forgetMemory, readMemory, saveMemory } from '../memory/index.js';
import { getCwd } from './safe-path.js';

export const memoryTool = tool({
  description:
    'Keep notes across sessions. action "save" adds one short note; "forget" removes notes containing `note`; "read" returns a memory file (use it for topic files listed in the memory index). scope "repo" is this project, "user" is the user across projects.',
  inputSchema: z.object({
    action: z.enum(['save', 'forget', 'read']),
    scope: z.enum(['repo', 'user']).default('repo'),
    note: z.string().optional().describe('The note to save, or text identifying notes to forget'),
    topic: z
      .string()
      .optional()
      .describe('Optional topic file, e.g. "testing"; omit for the MEMORY.md index'),
  }),
  execute: async ({ action, scope, note, topic }) => {
    const cwd = getCwd();
    if (action === 'read') {
      const { path, text } = await readMemory({ scope, topic }, cwd);
      return text === null ? { path, error: 'no such memory file' } : { path, text };
    }
    if (!note?.trim()) return { error: '`note` is required' };
    if (action === 'save') {
      const r = await saveMemory({ scope, note, topic }, cwd);
      return r.ok ? { saved: !r.duplicate, duplicate: r.duplicate ?? false, path: r.path } : { error: r.error };
    }
    const r = await forgetMemory({ scope, match: note, topic }, cwd);
    return { removed: r.removed, path: r.path };
  },
});
