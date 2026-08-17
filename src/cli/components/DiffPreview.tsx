import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

const MAX_DIFF_LINES = 40;

/**
 * Unified-diff preview shown inside an approval prompt. Line prefixes are kept
 * (rather than colouring whole rows) so the diff stays readable when copied
 * out of the terminal or viewed without colour.
 */
export function DiffPreview({ diff }: { diff: string }) {
  const rawLines = diff.split('\n');
  const start = rawLines.findIndex((l) => l.startsWith('@@'));
  const body = start === -1 ? rawLines : rawLines.slice(start);
  const shown = body.slice(0, MAX_DIFF_LINES);
  const hidden = body.length - shown.length;

  let added = 0;
  let removed = 0;
  for (const l of body) {
    if (l.startsWith('+')) added++;
    else if (l.startsWith('-')) removed++;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color={theme.success}>+{added}</Text>
        <Text color={theme.muted}> / </Text>
        <Text color={theme.danger}>-{removed}</Text>
      </Text>
      {shown.map((l, i) => {
        let color: string | undefined = theme.muted;
        if (l.startsWith('+')) color = theme.success;
        else if (l.startsWith('-')) color = theme.danger;
        else if (l.startsWith('@@')) color = theme.tool;
        return (
          <Text key={i} color={color}>
            {l || ' '}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color={theme.muted} dimColor>
          … {hidden} more line{hidden === 1 ? '' : 's'}
        </Text>
      )}
    </Box>
  );
}
