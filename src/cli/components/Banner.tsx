import React from 'react';
import { Box, Text } from 'ink';
import { theme, glyphs } from '../theme.js';

/**
 * One-time welcome banner, in the shape Copilot CLI uses: a rounded panel with
 * the product mark, then a short list of orientation tips. Printed once at the
 * top of the scrollback rather than pinned, so it scrolls away naturally.
 */
export function Banner({
  providerLabel,
  cwd,
  version,
}: {
  providerLabel: string;
  cwd: string;
  version: string;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
        flexDirection="column"
      >
        <Text>
          <Text color={theme.accent} bold>
            {glyphs.spark} bonfire
          </Text>
          <Text color={theme.muted}> v{version}</Text>
        </Text>
        <Text color={theme.muted}>Your code. Your model. Your machine.</Text>
      </Box>
      <Box flexDirection="column" paddingX={2} marginTop={1}>
        <Text color={theme.muted}>
          model  <Text color={theme.body}>{providerLabel}</Text>
        </Text>
        <Text color={theme.muted}>
          cwd    <Text color={theme.body}>{cwd}</Text>
        </Text>
        <Text> </Text>
        <Text color={theme.muted}>
          Ask a question, or describe a change you want made.
        </Text>
        <Text color={theme.muted}>
          Type <Text color={theme.accent}>/</Text> for commands ·{' '}
          <Text color={theme.accent}>/help</Text> for the full list ·{' '}
          <Text color={theme.accent}>esc</Text> to interrupt or quit
        </Text>
      </Box>
    </Box>
  );
}
