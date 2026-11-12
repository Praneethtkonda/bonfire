import React from 'react';
import { Box, Static, Text } from 'ink';
import type { Line } from '../types.js';
import { assertNever } from '../types.js';
import { Markdown } from '../markdown.js';
import { ResultGutter, ResultLine, ToolCall } from './ToolLine.js';
import { compactNumber, formatDuration, glyphs, theme } from '../theme.js';

/**
 * Scrollback. Rendered through Ink's <Static> so completed output is written
 * once and then owned by the terminal — the live region below it is the only
 * thing that repaints.
 */
export function Transcript({ lines }: { lines: Line[] }) {
  return (
    <Static items={lines}>
      {(l: Line, i: number) => <TranscriptLine key={i} line={l} />}
    </Static>
  );
}

/** `> message` — the user's turn, quiet so the answers stand out. */
export function UserMessage({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Box width={2} flexShrink={0}>
        <Text color={theme.muted}>{glyphs.prompt}</Text>
      </Box>
      <Text color={theme.muted}>{text}</Text>
    </Box>
  );
}

/** `⏺ reply` — assistant text, rendered as Markdown. */
export function AssistantMessage({ text }: { text: string }) {
  return (
    <Box marginTop={1}>
      <Box width={2} flexShrink={0}>
        <Text color={theme.body}>{glyphs.bullet}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Markdown text={text} />
      </Box>
    </Box>
  );
}

export function TranscriptLine({ line }: { line: Line }) {
  switch (line.kind) {
    case 'user':
      return <UserMessage text={line.text} />;
    case 'assistant':
      return <AssistantMessage text={line.text} />;
    case 'notice':
      return (
        <ResultGutter>
          <Text color={theme.muted}>{line.text}</Text>
        </ResultGutter>
      );
    case 'tool':
      return (
        <ToolCall
          name={line.name}
          args={line.args}
          result={line.result}
          interrupted={line.interrupted}
          durationMs={line.durationMs}
          diff={line.diff}
        />
      );
    case 'tool-result':
      return <ResultLine name={line.name} result={line.result} />;
    case 'error':
      return (
        <Box marginTop={1}>
          <Box width={2} flexShrink={0}>
            <Text color={theme.danger}>{glyphs.bullet}</Text>
          </Box>
          <Text color={theme.danger}>{line.text}</Text>
        </Box>
      );
    case 'interrupted':
      return (
        <ResultGutter>
          <Text color={theme.danger}>
            Interrupted <Text color={theme.muted}>· what should bonfire do instead?</Text>
          </Text>
        </ResultGutter>
      );
    case 'turn-summary':
      return (
        <Box marginTop={1}>
          <Text color={theme.muted}>
            {glyphs.spark} Worked for {formatDuration(line.seconds)}
            {line.outputTokens > 0 ? ` · ↓ ${compactNumber(line.outputTokens)} tokens` : ''}
          </Text>
        </Box>
      );
    default:
      return assertNever(line);
  }
}
