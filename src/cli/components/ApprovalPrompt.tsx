import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovalRequest } from '../../tools/index.js';
import { DiffPreview } from './DiffPreview.js';

export function ApprovalPrompt({ request }: { request: ApprovalRequest }) {
  if (request.tool === 'shell') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          shell → {request.cwd}
        </Text>
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="white">$ {request.command}</Text>
        </Box>
      </Box>
    );
  }
  if (request.tool === 'mcp') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          mcp → {request.name}
        </Text>
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="white">{JSON.stringify(request.args, null, 2)}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        {request.tool} → {request.path}
      </Text>
      <DiffPreview diff={request.diff} />
    </Box>
  );
}

export function approvalHelpText(request: ApprovalRequest): string {
  if (request.tool === 'shell') {
    return 'Run command? y = yes (enter), a = always (this session), n = no (esc)';
  }
  return 'Apply changes? y = yes (enter), n = no (esc)';
}
