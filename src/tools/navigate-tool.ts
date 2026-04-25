import { tool } from 'ai';
import { z } from 'zod';
import { ensureCodemap, navigateCodemap } from '../codemap/index.js';
import { getCwd } from './safe-path.js';

export const navigateTool = tool({
  description:
    'Explore the repo through the codemap — a hierarchical index with one-line summaries for every file and directory. Call with path="." for the repo root; descend by passing a relative path. Returns direct children only. Prefer this over list_dir for exploration: you read summaries, not source.',
  inputSchema: z.object({
    path: z
      .string()
      .default('.')
      .describe('Relative path from the repo root. Use "." for root.'),
  }),
  execute: async ({ path }) => {
    const map = await ensureCodemap(getCwd());
    return navigateCodemap(map, path);
  },
});
