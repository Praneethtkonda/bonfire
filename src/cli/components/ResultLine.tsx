import React from 'react';
import { Text } from 'ink';
import { truncate } from '../util.js';
import { theme, glyphs } from '../theme.js';

interface ToolResultShape {
  error?: string;
  status?: string;
  content?: string;
  stdout?: string;
  exitCode?: number;
  items?: unknown[];
  matches?: unknown[];
  matchCount?: number;
  filesScanned?: number;
  bytes?: number;
  totalLines?: number;
  truncated?: boolean;
  children?: unknown[];
  body?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Condense a tool result to the single most useful fact about it. */
export function summarizeResult(result: unknown): { text: string; tone: 'ok' | 'warn' | 'error' } {
  const r = (result ?? {}) as ToolResultShape;

  if (r.error) return { text: truncate(r.error, 160), tone: 'error' };
  if (r.status === 'skipped') return { text: 'skipped by user', tone: 'warn' };

  if (typeof r.matchCount === 'number') {
    const suffix = r.truncated ? ' (truncated)' : '';
    return {
      text: `${plural(r.matchCount, 'match')} in ${plural(r.filesScanned ?? 0, 'file')}${suffix}`,
      tone: r.matchCount > 0 ? 'ok' : 'warn',
    };
  }
  if (typeof r.exitCode === 'number') {
    return {
      text: r.exitCode === 0 ? 'done' : `exited ${r.exitCode}`,
      tone: r.exitCode === 0 ? 'ok' : 'error',
    };
  }
  if (r.status === 'written' || r.status === 'edited') {
    return { text: r.status, tone: 'ok' };
  }
  if (typeof r.content === 'string') {
    const lines = r.content === '' ? 0 : r.content.split('\n').length;
    return {
      text: `${plural(lines, 'line')}${r.truncated ? ' (truncated)' : ''}`,
      tone: 'ok',
    };
  }
  if (Array.isArray(r.items)) return { text: plural(r.items.length, 'entry'), tone: 'ok' };
  if (Array.isArray(r.children)) {
    return { text: plural(r.children.length, 'child'), tone: 'ok' };
  }
  if (typeof r.body === 'string') {
    return { text: `${plural(r.body.length, 'char')} fetched`, tone: 'ok' };
  }
  return { text: truncate(JSON.stringify(result ?? {}), 120), tone: 'ok' };
}

export function ResultLine({ result }: { name: string; result: unknown }) {
  const { text, tone } = summarizeResult(result);
  const color =
    tone === 'error' ? theme.danger : tone === 'warn' ? theme.warn : theme.muted;
  return (
    <Text>
      <Text color={theme.muted}>{'  '}{glyphs.branch} </Text>
      <Text color={color}>{text}</Text>
    </Text>
  );
}
