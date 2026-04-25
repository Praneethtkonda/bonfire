import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SlashCommand } from './types.js';

const SYSTEM_TEMPLATE = `# Project system prompt

Anything you write here is appended to bonfire's built-in system prompt
for this project. Use it to teach the model about conventions that aren't
obvious from the code.

Examples of useful instructions:
- This project uses Bun, not Node. Prefer \`bun test\` over \`npm test\`.
- Treat \`src/legacy/\` as read-only — never edit those files.
- Always run \`pnpm typecheck\` before declaring a task complete.
`;

const SKILL_TEMPLATE = `---
name: example
description: A short description shown to the model on startup
---

# Example skill

This skill is loaded on demand when the model calls load_skill("example").

Replace this body with your own instructions. Common shapes:

- A multi-step recipe ("To add a new API endpoint, do X then Y…")
- A coding convention ("All React components must…")
- A debugging playbook ("When tests fail, first check…")
`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const initCommand: SlashCommand = {
  trigger: '/init',
  description: 'Scaffold .bonfire/ with system.md and an example skill',
  match: (input) => input === '/init',
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    try {
      const dir = resolve(ctx.cwd, '.bonfire');
      const skillsDir = resolve(dir, 'skills');
      await mkdir(skillsDir, { recursive: true });

      const systemPath = resolve(dir, 'system.md');
      const skillPath = resolve(skillsDir, 'example.md');

      await writeFile(systemPath, SYSTEM_TEMPLATE, { flag: 'wx', encoding: 'utf-8' }).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== 'EEXIST') throw e;
        },
      );
      await writeFile(skillPath, SKILL_TEMPLATE, { flag: 'wx', encoding: 'utf-8' }).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== 'EEXIST') throw e;
        },
      );

      ctx.appendLines({
        kind: 'assistant',
        text: `Scaffolded:\n  ${systemPath}\n  ${skillPath}\n\nEdit them, then /skills reload (or restart bonfire) to pick up changes. Check the effective system prompt with /system.`,
      });
    } catch (e: unknown) {
      ctx.appendLines({ kind: 'error', text: errorMessage(e) });
    }
  },
};
