import React from 'react';
import { Text } from 'ink';
import type { TokenUsage, UsageTotals } from '../types.js';

export function UsageBar({
  totals,
  last,
}: {
  totals: UsageTotals;
  last: TokenUsage | null;
}) {
  if (totals.turns === 0) return null;
  return (
    <Text color="gray" dimColor>
      tokens · in {totals.input.toLocaleString()} · out{' '}
      {totals.output.toLocaleString()} · total{' '}
      {(totals.input + totals.output).toLocaleString()} · {totals.turns} turn
      {totals.turns === 1 ? '' : 's'}
      {last ? ` · last +${last.input}/${last.output}` : ''}
    </Text>
  );
}
