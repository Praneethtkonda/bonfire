import React from 'react';
import { Box, Text } from 'ink';

const MAX_DIFF_LINES = 40;

export function DiffPreview({ diff }: { diff: string }) {
  const rawLines = diff.split('\n');
  const start = rawLines.findIndex((l) => l.startsWith('@@'));
  const body = start === -1 ? rawLines : rawLines.slice(start);
  const shown = body.slice(0, MAX_DIFF_LINES);
  const hidden = body.length - shown.length;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      {shown.map((l, i) => {
        let color: string | undefined;
        if (l.startsWith('+')) color = 'green';
        else if (l.startsWith('-')) color = 'red';
        else if (l.startsWith('@@')) color = 'cyan';
        return (
          <Text key={i} color={color}>
            {l || ' '}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color="gray" dimColor>
          … {hidden} more line(s)
        </Text>
      )}
    </Box>
  );
}
