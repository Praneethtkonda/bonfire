import React from 'react';
import { Box, Text } from 'ink';
import type { ToolDescriptor } from '../../tools/index.js';

export function ToolsPane({
  tools,
  activeTool,
}: {
  tools: ToolDescriptor[];
  activeTool: string | null;
}) {
  if (tools.length === 0) return null;
  const builtins = tools.filter((t) => t.source === 'builtin');
  const mcp = tools.filter((t) => t.source === 'mcp');

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      width={36}
    >
      <Text color="gray" bold>
        Tools
      </Text>
      {builtins.map((t) => (
        <Row key={t.name} tool={t} active={t.name === activeTool} />
      ))}
      {mcp.length > 0 ? (
        <>
          <Text color="gray" dimColor>
            ── mcp ──
          </Text>
          {mcp.map((t) => (
            <Row key={t.name} tool={t} active={t.name === activeTool} />
          ))}
        </>
      ) : null}
    </Box>
  );
}

function Row({ tool, active }: { tool: ToolDescriptor; active: boolean }) {
  return (
    <Text color={active ? 'green' : 'gray'} bold={active}>
      {active ? '● ' : '  '}
      {tool.name}
      {tool.description ? <Text dimColor>{`  ${tool.description}`}</Text> : null}
    </Text>
  );
}
