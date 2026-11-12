import React from 'react';
import { Box, Text } from 'ink';
import type { CommandSuggestion } from '../commands/index.js';
import { theme } from '../theme.js';

const MAX_VISIBLE = 8;

/**
 * Slash-command palette under the input: the selected command in the accent
 * colour, the rest muted. ↑/↓ move, tab completes, enter runs.
 */
export function CommandSuggestions({
  items,
  selected,
}: {
  items: CommandSuggestion[];
  selected: number;
}) {
  if (items.length === 0) return null;

  // Keep the cursor in view without letting the window run past the end.
  const startIdx = Math.min(
    Math.max(0, selected - 2),
    Math.max(0, items.length - MAX_VISIBLE),
  );
  const endIdx = Math.min(items.length, startIdx + MAX_VISIBLE);
  const triggerWidth = Math.max(...items.map((s) => s.trigger.length));

  return (
    <Box flexDirection="column" paddingX={2}>
      {items.slice(startIdx, endIdx).map((s, idx) => {
        const isSel = startIdx + idx === selected;
        return (
          <Box key={s.trigger}>
            <Box width={triggerWidth + 3} flexShrink={0}>
              <Text color={isSel ? theme.accent : theme.body} bold={isSel}>
                {s.trigger}
              </Text>
            </Box>
            <Text color={isSel ? theme.accent : theme.muted} wrap="truncate-end">
              {s.description}
            </Text>
          </Box>
        );
      })}
      {endIdx < items.length ? (
        <Text color={theme.muted} dimColor>
          … {items.length - endIdx} more
        </Text>
      ) : null}
    </Box>
  );
}
