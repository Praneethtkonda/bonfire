import React from 'react';
import { Text } from 'ink';
import { truncate } from '../util.js';
import { theme, glyphs } from '../theme.js';

/**
 * Human-readable one-liner for a tool invocation, in Copilot CLI's
 * `verb target` register rather than a raw JSON dump. Falls back to compact
 * JSON for MCP tools we know nothing about.
 */
export function describeCall(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof a[k] === 'string' ? (a[k] as string) : undefined;

  switch (name) {
    case 'read_file': {
      const path = str('path') ?? '';
      const offset = a.offset;
      const limit = a.limit;
      if (typeof offset === 'number' || typeof limit === 'number') {
        return `Read ${path} (from line ${offset ?? 1})`;
      }
      return `Read ${path}`;
    }
    case 'write_file':
      return `Write ${str('path') ?? ''}`;
    case 'edit_file':
      return `Edit ${str('path') ?? ''}`;
    case 'list_dir':
      return `List ${str('path') || '.'}`;
    case 'navigate':
      return `Navigate ${str('path') || '.'}`;
    case 'search': {
      const glob = str('glob');
      return `Search /${str('pattern') ?? ''}/${glob ? ` in ${glob}` : ''}`;
    }
    case 'shell':
      return `Run ${str('command') ?? ''}`;
    case 'fetch_url':
      return `Fetch ${str('url') ?? ''}`;
    case 'load_skill':
      return `Load skill ${str('name') ?? ''}`;
    default: {
      const json = JSON.stringify(args ?? {});
      return json === '{}' ? name : `${name} ${json}`;
    }
  }
}

export function ToolLine({ name, args }: { name: string; args: unknown }) {
  return (
    <Text>
      <Text color={theme.tool}>{glyphs.bullet} </Text>
      <Text color={theme.body}>{truncate(describeCall(name, args), 160)}</Text>
    </Text>
  );
}
