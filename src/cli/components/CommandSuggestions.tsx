import React from 'react';
import { Box, Text } from 'ink';
import type { CommandSuggestion } from '../commands/index.js';

const MAX_VISIBLE = 6;

export function CommandSuggestions({
  items,
  selected,
}: {
  items: CommandSuggestion[];
  selected: number;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - shown.length;
  const triggerWidth = Math.max(...shown.map((s) => s.trigger.length));
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
    >
      {shown.map((s, i) => {
        const isSel = i === selected;
        return (
          <Text key={s.trigger} color={isSel ? 'black' : 'cyan'} backgroundColor={isSel ? 'cyan' : undefined}>
            {isSel ? '▸ ' : '  '}
            {s.trigger.padEnd(triggerWidth)}  <Text dimColor={!isSel}>{s.description}</Text>
          </Text>
        );
      })}
      {overflow > 0 ? (
        <Text dimColor>  … {overflow} more (keep typing to filter)</Text>
      ) : null}
      <Text dimColor>  ↑↓ to move · Tab to complete · Enter to run</Text>
    </Box>
  );
}
