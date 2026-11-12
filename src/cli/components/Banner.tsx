import React from 'react';
import { Box, Text } from 'ink';
import { useColumns } from '../hooks/useColumns.js';
import { glyphs, theme } from '../theme.js';
import { Logo, logoColorEnabled } from './Logo.js';

const WELCOME_MAX_WIDTH = 72;

/**
 * One-time welcome, printed at the top of the scrollback and left to scroll
 * away: the bonfire mark, a faint tagline, a welcome panel, and a few tips.
 */
export function Banner({
  providerLabel,
  cwd,
  version,
  color = logoColorEnabled(),
  columns: columnsOverride,
}: {
  providerLabel: string;
  cwd: string;
  version: string;
  /** Override colour detection (tests, previews). */
  color?: boolean;
  /** Override the measured terminal width (tests, previews). */
  columns?: number;
}) {
  const measured = useColumns();
  const columns = columnsOverride ?? measured;
  const boxWidth = Math.max(20, Math.min(columns, WELCOME_MAX_WIDTH));

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column" paddingLeft={1}>
        <Logo columns={columns} color={color} />
        <Text dimColor>
          bonfire · Your code. Your model. Your machine.  v{version}
        </Text>
      </Box>

      <Box
        marginTop={1}
        width={boxWidth}
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={1}
        flexDirection="column"
      >
        <Text>
          <Text color={theme.accent}>{glyphs.spark} </Text>
          <Text bold>Welcome to bonfire!</Text>
        </Text>
        <Box marginTop={1} paddingLeft={2} flexDirection="column">
          <Text color={theme.muted} italic>
            /help for help, /config for your setup
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.muted}>cwd: {cwd}</Text>
            <Text color={theme.muted}>model: {providerLabel}</Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1} paddingLeft={1} flexDirection="column">
        <Text color={theme.muted}>Tips for getting started:</Text>
        <Box flexDirection="column">
          <Text color={theme.muted}>1. Ask questions about your code, or describe a change to make</Text>
          <Text color={theme.muted}>2. bonfire asks before it edits a file or runs a command</Text>
          <Text color={theme.muted}>
            3. Type <Text color={theme.body}>/</Text> for commands, <Text color={theme.body}>/init</Text> to add project instructions
          </Text>
          <Text color={theme.muted}>
            4. Press <Text color={theme.body}>esc</Text> to interrupt, <Text color={theme.body}>?</Text> for shortcuts
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
