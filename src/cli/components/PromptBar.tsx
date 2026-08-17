import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { CodemapProgress } from '../types.js';
import { MultilineInput, type KeyMeta } from './MultilineInput.js';
import { theme, glyphs } from '../theme.js';
import { truncate } from '../util.js';

interface PromptBarProps {
  approvalHelp: string | null;
  busy: boolean;
  codemapProgress: CodemapProgress | null;
  thinkingPhrase: string;
  elapsedSeconds: number;
  activeToolLabel: string | null;
  input: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onKey?: (input: string, key: KeyMeta) => boolean;
  /** When true, hides the prompt entirely (used during reconfigure mode) */
  hidden?: boolean;
}

/**
 * The bottom-anchored input, styled after Copilot CLI: a full-width rounded
 * box containing the caret and the buffer. While the agent is working the box
 * is replaced by a single status line, so the screen never shows an input the
 * user cannot type into.
 */
export function PromptBar({
  approvalHelp,
  busy,
  codemapProgress,
  thinkingPhrase,
  elapsedSeconds,
  activeToolLabel,
  input,
  onChange,
  onSubmit,
  onKey,
  hidden,
}: PromptBarProps) {
  if (hidden) return null;

  if (approvalHelp) {
    return (
      <Box paddingX={1}>
        <Text color={theme.warn}>{approvalHelp}</Text>
      </Box>
    );
  }

  if (busy) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>
          <Text color={theme.accent}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.body}>
            {' '}
            {codemapProgress
              ? `Building codemap ${codemapProgress.done}/${codemapProgress.total}`
              : thinkingPhrase}
          </Text>
          <Text color={theme.muted}>
            {elapsedSeconds > 0 ? ` ${elapsedSeconds}s` : ''} · esc to interrupt
          </Text>
        </Text>
        {codemapProgress ? (
          <Text color={theme.muted} dimColor>
            {'  '}
            {truncate(codemapProgress.path, 70)}
          </Text>
        ) : null}
        {!codemapProgress && activeToolLabel ? (
          <Text color={theme.muted} dimColor>
            {'  '}
            {glyphs.branch} {truncate(activeToolLabel, 70)}
          </Text>
        ) : null}
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        {glyphs.prompt}{' '}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        <MultilineInput
          value={input}
          onChange={onChange}
          onSubmit={onSubmit}
          onKey={onKey}
          placeholder="Ask anything, or / for commands"
        />
      </Box>
    </Box>
  );
}
