import React from 'react';
import { Box, Text } from 'ink';
import type { Session } from '../../session/index.js';

export function Header({
  providerLabel,
  cwd,
  session,
}: {
  providerLabel: string;
  cwd: string;
  session: Session | null;
}) {
  return (
    <Box borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>
        <Text color="blue" bold>
          bonfire
        </Text>
        {'  '}
        <Text color="gray">
          {providerLabel} · cwd: {cwd}
          {session ? ` · session ${session.id.slice(0, 6)}` : ''}
          {' '}· esc to quit
        </Text>
      </Text>
    </Box>
  );
}
