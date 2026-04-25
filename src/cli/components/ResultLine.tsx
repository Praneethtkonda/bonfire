import React from 'react';
import { Text } from 'ink';
import { truncate } from '../util.js';

interface ToolResultShape {
  error?: string;
  status?: string;
  content?: string;
  stdout?: string;
  exitCode?: number;
}

function summarize(result: unknown): string {
  const r = (result ?? {}) as ToolResultShape;
  if (r.error) return `error: ${r.error}`;
  if (r.status === 'skipped') return 'skipped by user';
  if (typeof r.content === 'string') return `${r.content.length} chars`;
  if (r.stdout !== undefined) return `exit=${r.exitCode}`;
  return truncate(JSON.stringify(result));
}

export function ResultLine({ result }: { name: string; result: unknown }) {
  return (
    <Text color="gray">
      {'    '}↳ {summarize(result)}
    </Text>
  );
}
