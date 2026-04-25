import type { CommandContext, SlashCommand } from './types.js';
import { exitCommand } from './exit.js';
import { dirsCommand, addDirCommand } from './dirs.js';
import { codemapCommand } from './codemap.js';
import { sessionsCommand } from './sessions.js';
import { systemCommand } from './system.js';
import { skillsCommand } from './skills.js';
import { initCommand } from './init.js';
import { makeHelpCommand } from './help.js';

export type { CommandContext, SlashCommand };

const baseCommands: SlashCommand[] = [
  exitCommand,
  initCommand,
  dirsCommand,
  addDirCommand,
  codemapCommand,
  sessionsCommand,
  systemCommand,
  skillsCommand,
];

export const commands: SlashCommand[] = [
  ...baseCommands,
  makeHelpCommand(() => commands),
];

/** Find and run a matching slash command. Returns true if one matched. */
export async function runSlashCommand(
  ctx: CommandContext,
  input: string,
): Promise<boolean> {
  const cmd = commands.find((c) => c.match(input));
  if (!cmd) return false;
  await cmd.run(ctx, input);
  return true;
}

export interface CommandSuggestion {
  trigger: string;
  description: string;
  /** Replacement text to insert when the user accepts the suggestion. */
  insert: string;
}

/**
 * Compute autocomplete suggestions for the prompt buffer.
 * - "/" → list all commands
 * - "/co" → list commands starting with "/co"
 * - "/codemap " → list subcommands of /codemap
 * - "/codemap re" → filter subcommands by prefix
 */
export function suggestCommands(input: string): CommandSuggestion[] {
  if (!input.startsWith('/')) return [];
  const spaceIdx = input.indexOf(' ');
  if (spaceIdx === -1) {
    const prefix = input.toLowerCase();
    return commands
      .filter((c) => c.trigger.toLowerCase().startsWith(prefix))
      .map((c) => ({
        trigger: c.trigger,
        description: c.description,
        insert: c.usage ? c.trigger + ' ' : c.trigger,
      }));
  }
  const head = input.slice(0, spaceIdx);
  const rest = input.slice(spaceIdx + 1).toLowerCase();
  const cmd = commands.find((c) => c.trigger === head);
  if (!cmd?.subcommands) return [];
  return cmd.subcommands
    .filter((s) => s.name.toLowerCase().startsWith(rest))
    .map((s) => ({
      trigger: `${cmd.trigger} ${s.name}`,
      description: s.description,
      insert: `${cmd.trigger} ${s.name}`,
    }));
}
