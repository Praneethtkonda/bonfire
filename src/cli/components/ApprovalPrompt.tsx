import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovalRequest } from '../../tools/index.js';
import { DiffPreview } from './DiffPreview.js';
import { theme, glyphs } from '../theme.js';

/**
 * Approval card. One rounded panel per request with a title row naming the
 * action and the payload beneath it, matching the way Copilot CLI surfaces a
 * pending command.
 */
export function ApprovalPrompt({ request }: { request: ApprovalRequest }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      marginTop={1}
    >
      <Title request={request} />
      <Body request={request} />
    </Box>
  );
}

function Title({ request }: { request: ApprovalRequest }) {
  const label =
    request.tool === 'shell'
      ? 'Run shell command'
      : request.tool === 'mcp'
        ? `Call MCP tool ${request.name}`
        : request.tool === 'fetch'
          ? 'Fetch URL'
          : request.tool === 'write_file'
            ? `Write ${request.path}`
            : `Edit ${request.path}`;
  return (
    <Text>
      <Text color={theme.warn} bold>
        {glyphs.warn}{' '}
      </Text>
      <Text bold>{label}</Text>
    </Text>
  );
}

function Body({ request }: { request: ApprovalRequest }) {
  if (request.tool === 'shell') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.body}>$ {request.command}</Text>
        <Text color={theme.muted} dimColor>
          in {request.cwd}
        </Text>
      </Box>
    );
  }
  if (request.tool === 'mcp') {
    return (
      <Box paddingX={1}>
        <Text color={theme.muted}>{JSON.stringify(request.args, null, 2)}</Text>
      </Box>
    );
  }
  if (request.tool === 'fetch') {
    return (
      <Box paddingX={1}>
        <Text color={theme.body}>{request.url}</Text>
      </Box>
    );
  }
  return <DiffPreview diff={request.diff} />;
}

export function approvalHelpText(request: ApprovalRequest): string {
  const scope =
    request.tool === 'shell'
      ? 'this command'
      : request.tool === 'mcp'
        ? 'this tool'
        : request.tool === 'fetch'
          ? 'this host'
          : 'this file';
  return `y accept · a always for ${scope} · n reject (esc)`;
}
