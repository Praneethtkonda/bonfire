import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovalDecision, ApprovalRequest } from '../../tools/index.js';
import { DiffPreview, describeDiffStats, diffStats } from './DiffPreview.js';
import { useColumns } from '../hooks/useColumns.js';
import { glyphs, theme } from '../theme.js';

export interface ApprovalOption {
  decision: ApprovalDecision;
  label: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What "don't ask again" covers for this request. */
function alwaysScope(request: ApprovalRequest): string {
  switch (request.tool) {
    case 'shell':
      return 'this command';
    case 'mcp':
      return request.name;
    case 'fetch':
      return hostOf(request.url);
    default:
      return request.path;
  }
}

/** The numbered choices, in order. */
export function approvalOptions(request: ApprovalRequest): ApprovalOption[] {
  return [
    { decision: 'yes', label: 'Yes' },
    {
      decision: 'always',
      label: `Yes, and don't ask again for ${alwaysScope(request)} this session`,
    },
    { decision: 'no', label: 'No, and tell bonfire what to do differently (esc)' },
  ];
}

function title(request: ApprovalRequest): string {
  switch (request.tool) {
    case 'shell':
      return 'Bash command';
    case 'mcp':
      return 'Tool call';
    case 'fetch':
      return 'Fetch';
    case 'write_file':
      return 'Write file';
    case 'edit_file':
      return 'Edit file';
  }
}

/**
 * Permission prompt: a rounded panel naming the action, the command or diff,
 * then "Do you want to proceed?" with numbered options. Keys: ↑/↓ + enter,
 * the option number, or the y / a / n shortcuts; esc declines.
 */
export function ApprovalPrompt({
  request,
  selected = 0,
}: {
  request: ApprovalRequest;
  selected?: number;
}) {
  const options = approvalOptions(request);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={theme.warn}>
        {title(request)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Body request={request} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.body}>Do you want to proceed?</Text>
        {options.map((o, i) => {
          const isSel = i === selected;
          return (
            <Text key={o.decision} color={isSel ? theme.accent : theme.body}>
              {isSel ? `${glyphs.pointer} ` : '  '}
              {i + 1}. {o.label}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

function Body({ request }: { request: ApprovalRequest }) {
  const columns = useColumns();
  if (request.tool === 'shell') {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={theme.body}>{request.command}</Text>
        <Text color={theme.muted}>in {request.cwd}</Text>
      </Box>
    );
  }
  if (request.tool === 'mcp') {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={theme.body}>{request.name}</Text>
        <Text color={theme.muted}>{JSON.stringify(request.args, null, 2)}</Text>
      </Box>
    );
  }
  if (request.tool === 'fetch') {
    return (
      <Box paddingLeft={2}>
        <Text color={theme.body}>{request.url}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={theme.body} bold>
          {request.path}
        </Text>
        <Text color={theme.muted}> · {describeDiffStats(diffStats(request.diff))}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {/* Border (2) + padding (2). */}
        <DiffPreview diff={request.diff} width={Math.max(20, columns - 4)} />
      </Box>
    </Box>
  );
}
