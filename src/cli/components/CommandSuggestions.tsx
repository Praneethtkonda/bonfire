import React from 'react';
import { Box, Text } from 'ink';
import type { CommandSuggestion } from '../commands/index.js';

const MAX_VISIBLE = 10;
const VISIBLE_START = 0;

export function CommandSuggestions({
  items,
  selected,
}: {
  items: CommandSuggestion[];
  selected: number;
}) {
  if (items.length === 0) return null;
  
  const startIdx = Math.max(0, selected - 2);
  const endIdx = Math.min(items.length, startIdx + MAX_VISIBLE);
  const shown = items.slice(startIdx, endIdx);
  const triggerWidth = Math.max(...items.map((s) => s.trigger.length));
  
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
    >
      {shown.map((_, idx) => {
        const itemIdx = startIdx + idx;
        const isSel = itemIdx === selected;
        const s = items[itemIdx];
        return (
          <Text key={s.trigger} color={isSel ? 'black' : 'cyan'} backgroundColor={isSel ? 'cyan' : undefined}>
            {isSel ? '▸ ' : '  '}
            {s.trigger.padEnd(triggerWidth)}  <Text dimColor={!isSel}>{s.description}</Text>
          </Text>
        );
      })}
      {items.length > MAX_VISIBLE && endIdx < items.length ? (
        <Text dimColor>  … {items.length - endIdx} more</Text>
      ) : null}
      <Text dimColor>  ↑↓ to move · Tab to complete · Enter to run</Text>
    </Box>
  );
}
