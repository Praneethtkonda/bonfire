import { describe, expect, it } from 'vitest';
import { suggestCommands } from '../../src/cli/commands/index.js';

describe('suggestCommands', () => {
  it('returns nothing for plain text', () => {
    expect(suggestCommands('hello')).toEqual([]);
    expect(suggestCommands('')).toEqual([]);
  });

  it('lists every command on bare "/"', () => {
    const out = suggestCommands('/');
    const triggers = out.map((s) => s.trigger);
    expect(triggers).toContain('/help');
    expect(triggers).toContain('/codemap');
    expect(triggers).toContain('/sessions');
    expect(triggers).toContain('/reconfigure');
  });

  it('filters by prefix', () => {
    const out = suggestCommands('/co');
    const triggers = out.map((s) => s.trigger);
    expect(triggers).toContain('/codemap');
    expect(triggers).toContain('/config');
    expect(triggers).not.toContain('/sessions');
  });

  it('case-insensitive prefix', () => {
    const out = suggestCommands('/Co');
    expect(out.some((s) => s.trigger === '/codemap')).toBe(true);
  });

  it('lists subcommands once a space appears', () => {
    const out = suggestCommands('/codemap ');
    const names = out.map((s) => s.trigger);
    expect(names).toContain('/codemap status');
    expect(names).toContain('/codemap build');
    expect(names).toContain('/codemap rebuild');
  });

  it('filters subcommands by prefix', () => {
    const out = suggestCommands('/codemap re');
    const names = out.map((s) => s.trigger);
    expect(names).toEqual(['/codemap rebuild']);
  });

  it('returns empty list for unknown command prefix after space', () => {
    expect(suggestCommands('/nope ')).toEqual([]);
  });

  it('insert string ends with space when usage is present', () => {
    const out = suggestCommands('/');
    const sessions = out.find((s) => s.trigger === '/sessions');
    // /sessions has a usage signature, so accepting it should leave a trailing
    // space ready for subcommand input.
    expect(sessions?.insert).toMatch(/\/sessions $/);
  });

  it('insert string has no trailing space for argless commands', () => {
    const out = suggestCommands('/');
    const help = out.find((s) => s.trigger === '/help');
    expect(help?.insert).toBe('/help');
  });
});
