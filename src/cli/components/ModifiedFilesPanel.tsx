import React from 'react';
import { Box, Text } from 'ink';
import { changedFiles } from '../../tools/index.js';

export function ModifiedFilesPanel({ tick }: { tick: number }) {
  if (changedFiles.size === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text color="gray" bold>
        Modified files ({changedFiles.size})
      </Text>
      {Array.from(changedFiles.entries()).map(([p, c]) => (
        <Text key={`${p}:${tick}`} color="gray">
          {'  '}
          {p}
          {'  '}
          <Text color="green">{c.writes}w</Text>
          {' '}
          <Text color="yellow">{c.edits}e</Text>
          {' '}
          <Text color="gray" dimColor>
            {c.bytes}b
          </Text>
        </Text>
      ))}
    </Box>
  );
}
