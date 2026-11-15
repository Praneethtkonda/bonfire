import React from 'react';
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { AssistantMessage } from './Transcript.js';
import { glyphs, theme } from '../theme.js';

export function streamingPreview(text: string, columns: number, rows: number) {
  const width = Math.max(1, columns - 2);
  const limit = Math.max(1, Math.min(12, Math.floor(rows / 3)));
  const lines = wrapAnsi(text.replace(/\r\n?/g, '\n'), width, {
    hard: true, trim: false,
  }).split('\n');
  return {
    text: lines.slice(-limit).join('\n'),
    truncated: lines.length > limit,
    limit,
  };
}

export function StreamingMessage({ text, columns, rows }: {
  text: string; columns: number; rows: number;
}) {
  const preview = streamingPreview(text, columns, rows);
  if (!preview.truncated) return (
    <Box flexDirection="column" maxHeight={preview.limit + 1} overflow="hidden" flexShrink={0}>
      <AssistantMessage text={text} />
    </Box>
  );
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      <Text color={theme.muted} wrap="truncate-end">
        Live tail · full formatted reply appears when finished
      </Text>
      <Box>
        <Box width={2} flexShrink={0}><Text color={theme.body}>{glyphs.bullet}</Text></Box>
        <Text color={theme.body} wrap="truncate">{preview.text}</Text>
      </Box>
    </Box>
  );
}
