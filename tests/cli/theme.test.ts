import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  getThemeName,
  isThemeName,
  setTheme,
  subscribeTheme,
  theme,
  THEMES,
  themeNames,
  meter,
  meterColor,
  compactNumber,
  prettyPath,
} from '../../src/cli/theme.js';

afterEach(() => {
  setTheme(DEFAULT_THEME);
});

describe('theme presets', () => {
  it('defaults to the blue accent of the classic UI', () => {
    expect(DEFAULT_THEME).toBe('default');
    expect(THEMES.default.accent).toBe('blue');
    expect(THEMES.default.tool).toBe('cyan');
  });

  it('exposes every preset by name', () => {
    expect(themeNames()).toEqual(Object.keys(THEMES));
    expect(themeNames()).toContain('ember');
    expect(isThemeName('forest')).toBe(true);
    expect(isThemeName('nope')).toBe(false);
  });

  it('keeps danger red in every preset so destructive actions stay legible', () => {
    for (const preset of Object.values(THEMES)) {
      expect(preset.danger).toBe('red');
    }
  });

  it('uses only ANSI colour names so the terminal palette wins', () => {
    const ansi = new Set([
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray',
      'blackBright', 'redBright', 'greenBright', 'yellowBright',
      'blueBright', 'magentaBright', 'cyanBright', 'whiteBright',
    ]);
    for (const [name, preset] of Object.entries(THEMES)) {
      for (const key of ['accent', 'tool', 'success', 'warn', 'danger', 'muted'] as const) {
        expect(ansi.has(preset[key]), `${name}.${key} = ${preset[key]}`).toBe(true);
      }
    }
  });
});

describe('setTheme', () => {
  it('mutates the live theme object in place', () => {
    const before = theme;
    setTheme('ember');
    expect(theme).toBe(before); // same reference — imports stay valid
    expect(theme.accent).toBe('magenta');
    expect(getThemeName()).toBe('ember');
  });

  it('does not leak the description onto the live theme', () => {
    setTheme('forest');
    expect('description' in theme).toBe(false);
  });

  it('rejects an unknown name and leaves the theme untouched', () => {
    setTheme('forest');
    expect(setTheme('chartreuse')).toBe(false);
    expect(getThemeName()).toBe('forest');
    expect(theme.accent).toBe('green');
  });

  it('notifies subscribers on change', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeTheme(() => seen.push(getThemeName()));
    setTheme('ember');
    setTheme('mono');
    unsubscribe();
    setTheme('forest');
    expect(seen).toEqual(['ember', 'mono']);
  });

  it('does not notify for a rejected name', () => {
    let calls = 0;
    const unsubscribe = subscribeTheme(() => calls++);
    setTheme('bogus');
    unsubscribe();
    expect(calls).toBe(0);
  });
});

describe('meter', () => {
  it('fills proportionally', () => {
    expect(meter(0, 10)).toBe('──────────');
    expect(meter(1, 10)).toBe('━━━━━━━━━━');
    expect(meter(0.5, 10)).toBe('━━━━━─────');
  });

  it('clamps out-of-range ratios', () => {
    expect(meter(-1, 4)).toBe('────');
    expect(meter(3, 4)).toBe('━━━━');
  });

  it('escalates colour as the window fills', () => {
    setTheme(DEFAULT_THEME);
    expect(meterColor(0.1)).toBe(theme.muted);
    expect(meterColor(0.8)).toBe(theme.warn);
    expect(meterColor(0.95)).toBe(theme.danger);
  });
});

describe('compactNumber', () => {
  it('leaves small numbers alone', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
  });

  it('abbreviates thousands and millions', () => {
    expect(compactNumber(1234)).toBe('1.2k');
    expect(compactNumber(12_345)).toBe('12k');
    expect(compactNumber(1_500_000)).toBe('1.5M');
  });
});

describe('prettyPath', () => {
  it('substitutes a tilde for the home directory', () => {
    expect(prettyPath('/Users/me/src/app', '/Users/me')).toBe('~/src/app');
  });

  it('leaves unrelated paths alone', () => {
    expect(prettyPath('/opt/tools', '/Users/me')).toBe('/opt/tools');
    expect(prettyPath('/Users/me/x', '')).toBe('/Users/me/x');
  });
});
