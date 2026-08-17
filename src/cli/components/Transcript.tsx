import React from 'react';
import { Box, Static, Text } from 'ink';
import type { Line } from '../types.js';
import { assertNever } from '../types.js';
import { ToolLine } from './ToolLine.js';
import { ResultLine } from './ResultLine.js';
import { theme, glyphs } from '../theme.js';

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

function TranscriptLine({ line }: { line: Line }) {
  switch (line.kind) {
    case 'user':
      // The user's own turn is echoed in the accent colour with a marker, so
      // the eye can find turn boundaries when scrolling back.
      return (
        <Box marginTop={1}>
          <Text color={theme.accent} bold>
            {glyphs.prompt}{' '}
          </Text>
          <Text color={theme.body}>{line.text}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.body}>{line.text}</Text>
        </Box>
      );
    case 'notice':
      return (
        <Text color={theme.muted} dimColor>
          {glyphs.spark} {line.text}
        </Text>
      );
    case 'tool':
      return <ToolLine name={line.name} args={line.args} />;
    case 'tool-result':
      return <ResultLine name={line.name} result={line.result} />;
    case 'error':
      return (
        <Box marginTop={1}>
          <Text color={theme.danger} bold>
            {glyphs.cross}{' '}
          </Text>
          <Text color={theme.danger}>{line.text}</Text>
        </Box>
      );
    default:
      return assertNever(line);
  }
}
