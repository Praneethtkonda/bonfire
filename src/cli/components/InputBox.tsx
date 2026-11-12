import React from 'react';
import { Box, Text } from 'ink';
import { MultilineInput, type KeyMeta } from './MultilineInput.js';
import { glyphs, theme } from '../theme.js';

/**
 * The full-width rounded input box with a `>` caret. It stays on screen while
 * the agent works so the next message can be drafted; submitting waits until
 * the turn ends.
 */
export function InputBox({
  value,
  onChange,
  onSubmit,
  onKey,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onKey?: (input: string, key: KeyMeta) => boolean;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <Box borderStyle="round" borderColor={theme.muted} paddingX={1} marginTop={1}>
      <Box width={2} flexShrink={0}>
        <Text color={theme.body}>{glyphs.prompt}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <MultilineInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onKey={onKey}
          placeholder={placeholder}
          disabled={disabled}
        />
      </Box>
    </Box>
  );
}
