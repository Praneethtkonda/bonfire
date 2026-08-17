import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../../session/index.js';
import type { ContextStatus } from '../../agent/index.js';
import type { UsageTotals } from '../types.js';
import { compactNumber, meter, meterColor, prettyPath, theme } from '../theme.js';

/**
 * The dim single line beneath the input. Replaces the old top header + usage
 * bar: everything ambient lives here so the transcript stays uncluttered.
 */
export function StatusBar({
  providerLabel,
  cwd,
  home,
  session,
  totals,
  context,
  changedCount,
}: {
  providerLabel: string;
  cwd: string;
  home: string;
  session: Session | null;
  totals: UsageTotals;
  context: ContextStatus | null;
  changedCount: number;
}) {
  const segments: React.ReactNode[] = [];

  segments.push(
    <Text key="provider" color={theme.muted}>
      {providerLabel}
    </Text>,
  );
  segments.push(
    <Text key="cwd" color={theme.muted}>
      {prettyPath(cwd, home)}
    </Text>,
  );

  if (context && context.max > 0) {
    const pct = Math.round(context.ratio * 100);
    segments.push(
      <Text key="ctx" color={theme.muted}>
        ctx <Text color={meterColor(context.ratio)}>{meter(context.ratio)}</Text> {pct}%
      </Text>,
    );
  }

  if (totals.turns > 0) {
    segments.push(
      <Text key="tokens" color={theme.muted}>
        {compactNumber(totals.input + totals.output)} tok
      </Text>,
    );
  }

  if (changedCount > 0) {
    segments.push(
      <Text key="changed" color={theme.success}>
        {changedCount} file{changedCount === 1 ? '' : 's'} changed
      </Text>,
    );
  }

  if (session) {
    segments.push(
      <Text key="session" color={theme.muted}>
        {session.id.slice(0, 6)}
      </Text>,
    );
  }

  return (
    <Box paddingX={1}>
      <Text dimColor>
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <Text color={theme.muted}> · </Text> : null}
            {seg}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
