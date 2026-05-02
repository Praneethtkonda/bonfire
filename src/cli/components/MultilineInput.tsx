import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface MultilineInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (final: string) => void;
  /** Optional intercept; return true if the key was consumed and default handling should be skipped. */
  onKey?: (input: string, key: KeyMeta) => boolean;
  placeholder?: string;
  /** When true, the input is read-only (e.g. while busy). */
  disabled?: boolean;
}

export interface KeyMeta {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
}

/**
 * A small multiline text input for Ink.
 *
 * Keybindings:
 *   Enter           submit
 *   Shift+Enter     newline    (terminals that send \r\n on shift-enter)
 *   Alt+Enter       newline    (most terminals — works without xterm bracketed-paste hack)
 *   Ctrl+J          newline    (universal fallback)
 *   ←/→             move cursor in line
 *   ↑/↓             move cursor between lines
 *   Backspace       delete left
 *   Ctrl+A / Ctrl+E start / end of line
 *   Ctrl+U          delete to start of line
 *
 * Pasted bursts come through `useInput` as a single chunk including newlines —
 * we honour any \n in the chunk verbatim, so multi-line paste just works.
 */
export function MultilineInput({
  value,
  onChange,
  onSubmit,
  onKey,
  placeholder,
  disabled,
}: MultilineInputProps) {
  const [cursor, setCursor] = useState(value.length);

  // Re-pin cursor if the parent shrinks the value out from under us,
  // or if the new value is longer (e.g. autocomplete inserted text).
  if (cursor > value.length) setCursor(value.length);
  else if (value.length > cursor) setCursor(value.length);

  useInput((input, key) => {
    if (disabled) return;

    if (onKey?.(input, key as KeyMeta)) return;

    // Submit vs newline. Shift+Enter, Alt+Enter, Ctrl+J → newline. Plain Enter → submit.
    if (key.return) {
      const isNewline = key.shift || key.meta || (key.ctrl && input === '\n');
      if (isNewline) {
        const next = value.slice(0, cursor) + '\n' + value.slice(cursor);
        onChange(next);
        setCursor(cursor + 1);
        return;
      }
      onSubmit(value);
      return;
    }

    if (key.ctrl && input === 'j') {
      const next = value.slice(0, cursor) + '\n' + value.slice(cursor);
      onChange(next);
      setCursor(cursor + 1);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      const next = value.slice(0, cursor - 1) + value.slice(cursor);
      onChange(next);
      setCursor(cursor - 1);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }
    if (key.upArrow) {
      setCursor(moveCursorVertically(value, cursor, -1));
      return;
    }
    if (key.downArrow) {
      setCursor(moveCursorVertically(value, cursor, +1));
      return;
    }

    if (key.ctrl && input === 'a') {
      setCursor(startOfLine(value, cursor));
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursor(endOfLine(value, cursor));
      return;
    }
    if (key.ctrl && input === 'u') {
      const start = startOfLine(value, cursor);
      onChange(value.slice(0, start) + value.slice(cursor));
      setCursor(start);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const next = value.slice(0, cursor) + input + value.slice(cursor);
      onChange(next);
      setCursor(cursor + input.length);
    }
  });

  return <RenderedInput value={value} cursor={cursor} placeholder={placeholder} />;
}

function startOfLine(value: string, cursor: number): number {
  const prev = value.lastIndexOf('\n', cursor - 1);
  return prev === -1 ? 0 : prev + 1;
}

function endOfLine(value: string, cursor: number): number {
  const next = value.indexOf('\n', cursor);
  return next === -1 ? value.length : next;
}

function moveCursorVertically(value: string, cursor: number, dir: -1 | 1): number {
  const lineStart = startOfLine(value, cursor);
  const col = cursor - lineStart;

  if (dir < 0) {
    if (lineStart === 0) return 0;
    const prevLineStart = startOfLine(value, lineStart - 1);
    const prevLineEnd = lineStart - 1;
    return Math.min(prevLineEnd, prevLineStart + col);
  }
  const nextLineStart = endOfLine(value, cursor) + 1;
  if (nextLineStart > value.length) return value.length;
  const nextLineEnd = endOfLine(value, nextLineStart);
  return Math.min(nextLineEnd, nextLineStart + col);
}

function RenderedInput({
  value,
  cursor,
  placeholder,
}: {
  value: string;
  cursor: number;
  placeholder?: string;
}) {
  if (!value && placeholder) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text inverse> </Text>
          <Text dimColor>{placeholder}</Text>
        </Text>
      </Box>
    );
  }

  // Insert a visible cursor block by inverting one character. End-of-buffer is
  // a trailing inverted space so the user can see where they're typing.
  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1);
  const after = value.slice(cursor + 1);

  const lines: React.ReactNode[] = [];
  const beforeLines = before.split('\n');
  const lastBefore = beforeLines.pop() ?? '';
  beforeLines.forEach((l, i) => lines.push(<Text key={`b${i}`}>{l || ' '}</Text>));

  const afterLines = (at + after).split('\n');
  const firstAfter = afterLines.shift() ?? '';
  const cursorChar = at === '\n' || at === '' ? ' ' : at;
  const restOfFirstAfter = at === '\n' ? '' : firstAfter.slice(1);

  lines.push(
    <Text key="cursor">
      {lastBefore}
      <Text inverse>{cursorChar}</Text>
      {restOfFirstAfter}
    </Text>,
  );

  if (at === '\n') {
    afterLines.unshift('');
  }
  afterLines.forEach((l, i) => lines.push(<Text key={`a${i}`}>{l || ' '}</Text>));

  return <Box flexDirection="column">{lines}</Box>;
}
