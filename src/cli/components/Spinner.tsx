import React from 'react';
import { Box, Text } from 'ink';
import { useTicker } from '../hooks/useTicker.js';
import { useColumns } from '../hooks/useColumns.js';
import { compactNumber, formatDuration, glyphs, theme } from '../theme.js';
import { ResultGutter } from './ToolLine.js';

const FRAME_MS = 120;
/** Forwards then backwards, so the glyph breathes rather than jumps. */
const FRAMES = [...glyphs.spinner, ...[...glyphs.spinner].reverse()];

/** The tail of the reasoning stream, cut at a word boundary. */
export function reasoningTail(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= room) return flat;
  const tail = flat.slice(flat.length - room + 1);
  const space = tail.indexOf(' ');
  return `…${space > 0 && space < 20 ? tail.slice(space + 1) : tail}`;
}

/**
 * `✻ Pondering… (12s · ↓ 1.2k tokens · esc to interrupt)` — the working
 * indicator above the input, with a faint line of the model's reasoning when
 * it streams any.
 */
export function Spinner({
  label,
  seconds,
  tokens,
  detail,
  reasoning,
}: {
  label: string;
  seconds: number;
  tokens: number;
  /** A second muted line (e.g. the file a long command is working on). */
  detail?: string | null;
  reasoning?: string;
}) {
  const frame = useTicker(FRAME_MS);
  const columns = useColumns();
  const meta = [formatDuration(seconds)];
  if (tokens > 0) meta.push(`↓ ${compactNumber(tokens)} tokens`);
  meta.push('esc to interrupt');
  const sub = detail ?? (reasoning ? reasoningTail(reasoning, Math.max(20, columns - 10)) : '');

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={theme.spinner}>{FRAMES[frame % FRAMES.length]} </Text>
        <Text color={theme.spinner}>{label}</Text>
        <Text color={theme.muted}> ({meta.join(' · ')})</Text>
      </Text>
      {sub ? (
        <ResultGutter>
          <Text color={theme.muted} dimColor italic={!detail} wrap="truncate-end">
            {sub}
          </Text>
        </ResultGutter>
      ) : null}
    </Box>
  );
}
