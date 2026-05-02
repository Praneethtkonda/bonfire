import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { CodemapProgress } from '../types.js';
import { MultilineInput, type KeyMeta } from './MultilineInput.js';

interface PromptBarProps {
  approvalHelp: string | null;
  busy: boolean;
  codemapProgress: CodemapProgress | null;
  thinkingPhrase: string;
  input: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onKey?: (input: string, key: KeyMeta) => boolean;
  /** When true, hides the prompt entirely (used during reconfigure mode) */
  hidden?: boolean;
}

export function PromptBar({
  approvalHelp,
  busy,
  codemapProgress,
  thinkingPhrase,
  input,
  onChange,
  onSubmit,
  onKey,
  hidden,
}: PromptBarProps) {
  if (hidden) {
    return null;
  }
  if (approvalHelp) {
    return <Text color="yellow">{approvalHelp}</Text>;
  }
  if (busy) {
    return codemapProgress ? (
      <Text color="yellow">
        <Spinner type="dots" /> codemap · {codemapProgress.done}/{codemapProgress.total} ·{' '}
        {codemapProgress.path}
      </Text>
    ) : (
      <Text color="yellow">
        <Spinner type="dots" /> {thinkingPhrase}
      </Text>
    );
  }
  return (
    <Box>
      <Text color="green" bold>
        ❯{' '}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        <MultilineInput
          value={input}
          onChange={onChange}
          onSubmit={onSubmit}
          onKey={onKey}
          placeholder='type your prompt — "/" for commands · Shift+Enter for newline'
        />
      </Box>
    </Box>
  );
}
