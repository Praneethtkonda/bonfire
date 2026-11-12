import React from 'react';
import { Box, Text } from 'ink';
import type { ContextStatus } from '../../agent/index.js';
import { theme } from '../theme.js';

/** Context usage at which the footer starts warning about auto-compaction. */
export const CONTEXT_HINT_FROM = 0.6;

/**
 * "Context left until auto-compact: 23%", or null while there's plenty left.
 * `threshold` is the fraction of the window at which history is compacted;
 * null means auto-compaction is off, so report raw usage instead.
 */
export function contextHint(
  context: ContextStatus | null,
  threshold: number | null,
): { text: string; urgent: boolean } | null {
  if (!context || context.max <= 0 || context.ratio < CONTEXT_HINT_FROM) return null;
  if (threshold && threshold > 0) {
    const left = Math.max(0, Math.round(((threshold - context.ratio) / threshold) * 100));
    return { text: `Context left until auto-compact: ${left}%`, urgent: left <= 10 };
  }
  const used = Math.round(context.ratio * 100);
  return { text: `Context ${used}% full · /compact to free space`, urgent: used >= 90 };
}

/**
 * One quiet line under the input: a shortcut hint on the left, and on the
 * right the context warning (only when it matters) and the model.
 */
export function Footer({
  inputEmpty,
  context,
  compactThreshold,
  providerLabel,
}: {
  inputEmpty: boolean;
  context: ContextStatus | null;
  compactThreshold: number | null;
  providerLabel: string;
}) {
  const hint = contextHint(context, compactThreshold);
  return (
    <Box paddingX={2} justifyContent="space-between">
      <Box flexShrink={1}>
        {inputEmpty ? (
          <Text color={theme.muted}>? for shortcuts</Text>
        ) : (
          <Text color={theme.muted}>enter to send · shift+enter for newline</Text>
        )}
      </Box>
      <Box flexShrink={1} marginLeft={2}>
        <Text wrap="truncate-start">
          {hint ? (
            <Text color={hint.urgent ? theme.warn : theme.muted}>
              {hint.text}
              {'  '}
            </Text>
          ) : null}
          <Text color={theme.muted} dimColor>
            {providerLabel}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}

const SHORTCUTS: [string, string][] = [
  ['/ for commands', 'shift+enter or ctrl+j for newline'],
  ['esc to interrupt', 'ctrl+a / ctrl+e to line start / end'],
  ['esc to clear input or quit', 'ctrl+u to delete to line start'],
  ['# note to remember it', '↑ / ↓ to move between lines'],
];

/** Shown in place of the footer after `?` on an empty prompt. */
export function Shortcuts() {
  const left = Math.max(...SHORTCUTS.map(([l]) => l.length)) + 4;
  return (
    <Box flexDirection="column" paddingX={2}>
      {SHORTCUTS.map(([l, r]) => (
        <Box key={l}>
          <Box width={left} flexShrink={0}>
            <Text color={theme.muted}>{l}</Text>
          </Box>
          <Text color={theme.muted}>{r}</Text>
        </Box>
      ))}
    </Box>
  );
}
