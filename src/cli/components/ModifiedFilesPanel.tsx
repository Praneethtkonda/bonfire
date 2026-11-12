import React from 'react';
import { Box, Text } from 'ink';
import { changedFiles } from '../../tools/index.js';
import { useColumns } from '../hooks/useColumns.js';
import { theme } from '../theme.js';

/**
 * Files touched during this conversation, on one quiet line above the input:
 * `◇ 3 files changed · src/a.ts · src/b.ts · +1 more`. Shown only once
 * something has changed; `tick` repaints it after each tool result.
 */
export function ModifiedFilesPanel({ tick }: { tick: number }) {
  const columns = useColumns();
  if (changedFiles.size === 0) return null;
  const paths = Array.from(changedFiles.keys());
  const head = `◇ ${paths.length} file${paths.length === 1 ? '' : 's'} changed`;

  // Fit as many paths as the width allows, then summarise the rest.
  const room = columns - 4 - head.length;
  const shown: string[] = [];
  let used = 0;
  for (const p of paths) {
    const cost = p.length + 3;
    const reserve = shown.length + 1 < paths.length ? 12 : 0;
    if (used + cost + reserve > room) break;
    shown.push(p);
    used += cost;
  }
  const rest = paths.length - shown.length;

  return (
    <Box paddingX={2} marginTop={1} key={tick}>
      <Text color={theme.muted} wrap="truncate-end">
        <Text color={theme.success}>{head}</Text>
        {shown.map((p) => ` · ${p}`).join('')}
        {rest > 0 ? ` · +${rest} more` : ''}
      </Text>
    </Box>
  );
}
