import type { SlashCommand } from './types.js';
import { loadConfig, saveConfig, getConfigPath } from '../../config.js';
import {
  DEFAULT_THEME,
  getThemeName,
  setTheme,
  THEMES,
  themeNames,
} from '../theme.js';

function renderList(): string {
  const active = getThemeName();
  const width = Math.max(...themeNames().map((n) => n.length));
  const rows = Object.entries(THEMES).map(([name, preset]) => {
    const marker = name === active ? '▸' : ' ';
    const suffix = name === DEFAULT_THEME ? ' (default)' : '';
    return `${marker} ${name.padEnd(width)}  ${preset.description}${suffix}`;
  });
  return [
    'Themes:',
    ...rows,
    '',
    'Run /theme <name> to switch. The choice is saved to your global config.',
  ].join('\n');
}

export const themeCommand: SlashCommand = {
  trigger: '/theme',
  description: 'Show or change the colour theme',
  usage: '/theme [name]',
  subcommands: Object.entries(THEMES).map(([name, preset]) => ({
    name,
    description: preset.description,
  })),
  match: (input) => input.trim() === '/theme' || input.trim().startsWith('/theme '),
  async run(ctx, input) {
    ctx.appendLines({ kind: 'user', text: input });
    const name = input.trim().slice('/theme'.length).trim();

    if (!name) {
      ctx.appendLines({ kind: 'assistant', text: renderList() });
      return;
    }

    if (!setTheme(name)) {
      ctx.appendLines({
        kind: 'error',
        text: `Unknown theme "${name}". Available: ${themeNames().join(', ')}`,
      });
      return;
    }

    // Persist to the global config so the choice survives a restart. A failure
    // here is worth reporting but must not undo the switch the user can
    // already see — the session stays themed either way.
    try {
      const cfg = await loadConfig(ctx.cwd);
      await saveConfig({ ...cfg, ui: { ...cfg.ui, theme: name } });
      ctx.appendLines({
        kind: 'notice',
        text: `Theme set to ${name} · saved to ${getConfigPath()}`,
      });
    } catch (e: unknown) {
      ctx.appendLines({
        kind: 'notice',
        text: `Theme set to ${name} for this session (could not save config: ${
          e instanceof Error ? e.message : String(e)
        })`,
      });
    }
  },
};
