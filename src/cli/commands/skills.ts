import { findSkill, invalidateSkills, loadSkills } from '../../skills/index.js';
import type { SlashCommand } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const skillsCommand: SlashCommand = {
  trigger: '/skills',
  description: 'List or inspect available skills',
  usage: '/skills [show <name>|reload]',
  subcommands: [
    { name: 'show', description: 'Print a skill body — /skills show <name>' },
    { name: 'reload', description: 'Re-scan skill directories' },
  ],
  match: (input) => input === '/skills' || input.startsWith('/skills '),
  async run(ctx, input) {
    const sub = input.slice('/skills'.length).trim();
    ctx.appendLines({ kind: 'user', text: input });
    try {
      if (sub === '' || sub === 'list' || sub === 'ls') {
        const skills = await loadSkills(ctx.cwd);
        if (skills.length === 0) {
          ctx.appendLines({
            kind: 'assistant',
            text: `No skills loaded.\n\nDrop markdown files in:\n  ~/.bonfire/skills/<name>.md     (global)\n  ${ctx.cwd}/.bonfire/skills/<name>.md   (project)\n\nEach file: optional --- frontmatter (name, description) + body.`,
          });
          return;
        }
        const width = Math.max(...skills.map((s) => s.name.length));
        const lines = skills.map((s) => {
          const left = s.name.padEnd(width);
          const tag = s.source === 'project' ? '[project]' : '[global] ';
          return `  ${tag} ${left}  ${s.description}`;
        });
        ctx.appendLines({
          kind: 'assistant',
          text: `Skills (${skills.length}):\n${lines.join('\n')}\n\n/skills show <name> · /skills reload`,
        });
        return;
      }
      if (sub === 'reload') {
        invalidateSkills();
        const skills = await loadSkills(ctx.cwd);
        ctx.appendLines({
          kind: 'assistant',
          text: `Reloaded ${skills.length} skill(s).`,
        });
        return;
      }
      if (sub.startsWith('show ')) {
        const name = sub.slice('show '.length).trim();
        if (!name) {
          ctx.appendLines({ kind: 'error', text: 'Usage: /skills show <name>' });
          return;
        }
        const skill = await findSkill(name, ctx.cwd);
        if (!skill) {
          ctx.appendLines({ kind: 'error', text: `Unknown skill: ${name}` });
          return;
        }
        ctx.appendLines({
          kind: 'assistant',
          text: `── ${skill.name} (${skill.source}) ──\n${skill.path}\n\n${skill.description ? `${skill.description}\n\n` : ''}${skill.body}\n── end ──`,
        });
        return;
      }
      ctx.appendLines({
        kind: 'error',
        text: `Unknown /skills subcommand: ${sub}. Use list, show <name>, reload.`,
      });
    } catch (e: unknown) {
      ctx.appendLines({ kind: 'error', text: errorMessage(e) });
    }
  },
};
