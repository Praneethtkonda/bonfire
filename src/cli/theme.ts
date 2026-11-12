/**
 * Shared visual language for the TUI.
 *
 * A calm, mostly-monochrome transcript where colour is reserved for meaning
 * (tool status, diffs, errors), a single rounded input box anchored at the
 * bottom, and a quiet hint line beneath it.
 *
 * Foreground colours use the 16 ANSI names so the result inherits the user's
 * terminal palette instead of fighting it — a solarized or gruvbox terminal
 * gets a solarized or gruvbox bonfire for free. Diff row backgrounds are
 * the exception: a tinted row needs a specific shade to stay readable, and
 * chalk maps it down to the nearest colour on 256- or 16-colour terminals.
 *
 * `theme` is a live object: `setTheme` mutates it in place and notifies
 * subscribers, so every component that did `import { theme }` picks up the
 * change without threading a React context through the whole tree.
 */

export interface Theme {
  /** Brand accent — the bonfire mark and the focused input border. */
  accent: string;
  /** Tool invocations. */
  tool: string;
  /** Successful/positive state, additions in diffs. */
  success: string;
  /** Warnings and pending approvals. */
  warn: string;
  /** Errors and deletions in diffs. */
  danger: string;
  /** Secondary text: hints, metadata, status line. */
  muted: string;
  /** Primary body text — undefined inherits the terminal foreground. */
  body: string | undefined;
  /** The working spinner and its verb. */
  spinner: string;
  /** Inline `code` in assistant markdown. */
  code: string;
  /** Background of an added diff row; undefined leaves the row untinted. */
  diffAddedBg: string | undefined;
  /** Background of a removed diff row; undefined leaves the row untinted. */
  diffRemovedBg: string | undefined;
  /** Text on a tinted diff row; undefined inherits the terminal foreground. */
  diffText: string | undefined;
}

export interface ThemePreset extends Theme {
  description: string;
}

/**
 * Semantic colours (success/warn/danger) are deliberately near-identical
 * across presets: green-means-good and red-means-destructive are conventions
 * worth more than novelty, and an approval prompt is the wrong place to get
 * decorative. Presets vary the accent and tool colours.
 */
export const THEMES: Record<string, ThemePreset> = {
  default: {
    description: 'Blue accent, cyan tools — the classic bonfire look',
    accent: 'blue',
    tool: 'cyan',
    success: 'green',
    warn: 'yellow',
    danger: 'red',
    muted: 'gray',
    body: undefined,
    spinner: 'magenta',
    code: 'cyan',
    diffAddedBg: '#225c2b',
    diffRemovedBg: '#7a2936',
    diffText: 'white',
  },
  ember: {
    description: 'Magenta accent, yellow tools — warmer, higher contrast',
    accent: 'magenta',
    tool: 'yellow',
    success: 'green',
    warn: 'yellow',
    danger: 'red',
    muted: 'gray',
    body: undefined,
    spinner: 'yellow',
    code: 'yellow',
    diffAddedBg: '#225c2b',
    diffRemovedBg: '#7a2936',
    diffText: 'white',
  },
  forest: {
    description: 'Green accent, cyan tools — low-key and cool',
    accent: 'green',
    tool: 'cyan',
    success: 'green',
    warn: 'yellow',
    danger: 'red',
    muted: 'gray',
    body: undefined,
    spinner: 'green',
    code: 'cyan',
    diffAddedBg: '#225c2b',
    diffRemovedBg: '#7a2936',
    diffText: 'white',
  },
  light: {
    description: 'For light terminal backgrounds — pale diff rows, darker accents',
    accent: 'blue',
    tool: 'blue',
    success: 'green',
    warn: 'yellow',
    danger: 'red',
    muted: 'gray',
    body: undefined,
    spinner: 'magenta',
    code: 'magenta',
    diffAddedBg: '#d7f5dd',
    diffRemovedBg: '#fbdde1',
    diffText: 'black',
  },
  mono: {
    description: 'Grayscale except errors — for busy or low-colour terminals',
    accent: 'white',
    tool: 'white',
    success: 'white',
    warn: 'gray',
    danger: 'red',
    muted: 'gray',
    body: undefined,
    spinner: 'white',
    code: 'white',
    diffAddedBg: undefined,
    diffRemovedBg: undefined,
    diffText: undefined,
  },
};

export const DEFAULT_THEME = 'default';

export function isThemeName(name: string): boolean {
  return Object.hasOwn(THEMES, name);
}

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

function stripDescription(preset: ThemePreset): Theme {
  const { description: _description, ...rest } = preset;
  return rest;
}

/** The live theme. Mutated in place by `setTheme` — never reassigned. */
export const theme: Theme = stripDescription(THEMES[DEFAULT_THEME]);

let activeName = DEFAULT_THEME;
const listeners = new Set<() => void>();

export function getThemeName(): string {
  return activeName;
}

/**
 * Switch the active theme. Returns false for an unknown name so callers can
 * report it rather than silently leaving the UI unchanged.
 */
export function setTheme(name: string): boolean {
  const preset = THEMES[name];
  if (!preset) return false;
  Object.assign(theme, stripDescription(preset));
  activeName = name;
  for (const fn of listeners) fn();
  return true;
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const glyphs = {
  /** The caret inside the input box and on echoed user turns. */
  prompt: '>',
  /** Marks the selected option in a menu. */
  pointer: '❯',
  /** Leads every assistant message and tool call. */
  bullet: '⏺',
  /** Hangs a tool result or a notice off the line above it. */
  result: '⎿',
  /** Working spinner frames, played forwards then backwards. */
  spinner: ['·', '✢', '✳', '✶', '✻', '✽'],
  spark: '✻',
  pause: '⏸',
  check: '✓',
  cross: '✗',
  ellipsis: '…',
} as const;

/** The bonfire brand gradient: red-orange flame to amber. */
export const BRAND_GRADIENT = { from: '#ff4d00', to: '#ffb300' } as const;

/** Render a proportional bar used by the context meter. */
export function meter(ratio: number, width = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `${'━'.repeat(filled)}${'─'.repeat(Math.max(0, width - filled))}`;
}

/** Colour for a context meter given how full it is. */
export function meterColor(ratio: number): string {
  if (ratio >= 0.9) return theme.danger;
  if (ratio >= 0.75) return theme.warn;
  return theme.muted;
}

/** Compact a token count: 1234 → "1.2k". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Human duration for the spinner and turn summary: 7 → "7s", 75 → "1m 15s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Shorten a path for the status line: /Users/me/src/app → ~/src/app. */
export function prettyPath(p: string, home: string): string {
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}
