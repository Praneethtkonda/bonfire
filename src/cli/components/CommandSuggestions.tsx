import React from 'react';
import { Box, Text } from 'ink';
import type { CommandSuggestion } from '../commands/index.js';
import { theme, glyphs } from '../theme.js';

const MAX_VISIBLE = 8;

/**
 * Slash-command palette shown above the input. Borderless and dim so it reads
 * as an overlay on the prompt rather than another panel competing with it.
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
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      {items.slice(startIdx, endIdx).map((s, idx) => {
        const isSel = startIdx + idx === selected;
        return (
          <Text key={s.trigger}>
            <Text color={isSel ? theme.accent : theme.muted}>
              {isSel ? `${glyphs.selected} ` : '  '}
            </Text>
            <Text color={isSel ? theme.accent : theme.body} bold={isSel}>
              {s.trigger.padEnd(triggerWidth)}
            </Text>
            <Text color={theme.muted} dimColor>
              {'  '}
              {s.description}
            </Text>
          </Text>
        );
      })}
      {endIdx < items.length ? (
        <Text color={theme.muted} dimColor>
          {'  '}… {items.length - endIdx} more
        </Text>
      ) : null}
      <Text color={theme.muted} dimColor>
        {'  '}↑↓ navigate · tab complete · enter run
      </Text>
    </Box>
  );
}
