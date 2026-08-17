import React from 'react';
import { Box, Text } from 'ink';
import { changedFiles } from '../../tools/index.js';
import { theme, glyphs } from '../theme.js';

const MAX_ROWS = 8;

/**
 * Files touched during this conversation. Shown only while there is something
 * to report; the count also appears in the status line.
 */
export function ModifiedFilesPanel({ tick }: { tick: number }) {
  if (changedFiles.size === 0) return null;
  const entries = Array.from(changedFiles.entries());
  const shown = entries.slice(0, MAX_ROWS);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color={theme.muted}>
        {glyphs.spark} {entries.length} file{entries.length === 1 ? '' : 's'} changed
      </Text>
      {shown.map(([p, c]) => (
        <Text key={`${p}:${tick}`}>
          <Text color={theme.muted}>{'  '}{glyphs.branch} </Text>
          <Text color={theme.body}>{p}</Text>
          <Text color={theme.muted} dimColor>
            {'  '}
            {c.writes > 0 ? `${c.writes}w` : ''}
            {c.writes > 0 && c.edits > 0 ? ' ' : ''}
            {c.edits > 0 ? `${c.edits}e` : ''}
          </Text>
        </Text>
      ))}
      {entries.length > shown.length ? (
        <Text color={theme.muted} dimColor>
          {'  '}… {entries.length - shown.length} more
        </Text>
      ) : null}
    </Box>
  );
}
