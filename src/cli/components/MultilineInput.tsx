import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

/** Anything below this gets inserted verbatim; above it, redacted to a placeholder. */
const PASTE_REDACT_THRESHOLD = 200;
const PLACEHOLDER_RE = /\[Pasted #(\d+) \([^)]+\)\]/g;

interface PasteRecord {
  id: number;
  content: string;
  lines: number;
  chars: number;
}

function makePlaceholderLabel(rec: PasteRecord): string {
  const stat =
    rec.lines === 1
      ? `${rec.chars} chars`
      : `${rec.lines} lines, ${rec.chars} chars`;
  return `[Pasted #${rec.id} (${stat})]`;
}

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
 *   Shift+Enter     newline    (modern terminals — Kitty keyboard protocol)
 *   Alt+Enter       newline    (works in iTerm2 / WezTerm / Ghostty / Apple Terminal)
 *   Ctrl+J          newline    (universal fallback — works everywhere)
 *   ←/→             move cursor in line
 *   ↑/↓             move cursor between lines
 *   Backspace       delete left
 *   Ctrl+A / Ctrl+E start / end of line
 *   Ctrl+U          delete to start of line
 *
 * Multi-line paste relies on bracketed paste mode (enabled in bin.tsx). When a
 * paste is multi-line or longer than PASTE_REDACT_THRESHOLD, the displayed
 * value gets a placeholder like `[Pasted #1 (35 lines, 1234 chars)]` while the
 * real content is held in a side-map. On submit the placeholders are expanded
 * back to the original text before invoking onSubmit.
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

  const pastesRef = useRef<Map<number, PasteRecord>>(new Map());
  const nextPasteIdRef = useRef(1);

  // Wipe paste storage when the parent fully clears the input (after submit
  // or a manual reset). Numbering restarts at #1 each round.
  useEffect(() => {
    if (value === '') {
      pastesRef.current.clear();
      nextPasteIdRef.current = 1;
    }
  }, [value]);

  const insertAtCursor = (text: string) => {
    if (!text) return;
    const next = value.slice(0, cursor) + text + value.slice(cursor);
    onChange(next);
    setCursor(cursor + text.length);
  };

  const insertPastePlaceholder = (raw: string) => {
    const id = nextPasteIdRef.current++;
    const rec: PasteRecord = {
      id,
      content: raw,
      lines: raw.split('\n').length,
      chars: raw.length,
    };
    pastesRef.current.set(id, rec);
    insertAtCursor(makePlaceholderLabel(rec));
  };

  const expandPlaceholders = (text: string): string => {
    return text.replace(PLACEHOLDER_RE, (match, idStr: string) => {
      const rec = pastesRef.current.get(Number(idStr));
      return rec ? rec.content : match;
    });
  };

  useInput((input, key) => {
    if (disabled) return;

    if (onKey?.(input, key as KeyMeta)) return;

    // Multi-character input arrives as a single chunk when bracketed paste
    // mode is on, or for any sufficiently fast typing burst. Decide between
    // verbatim insert and redacted placeholder based on size + line count.
    if (input.length > 1 && !key.ctrl && !key.meta) {
      const normalized = input.replace(/\r\n?/g, '\n');
      const isHugePaste =
        normalized.includes('\n') || normalized.length > PASTE_REDACT_THRESHOLD;
      if (isHugePaste) {
        insertPastePlaceholder(normalized);
      } else {
        insertAtCursor(normalized);
      }
      return;
    }

    // Submit vs newline. Shift+Enter, Alt+Enter, Ctrl+J → newline. Plain Enter → submit.
    if (key.return) {
      const isNewline = key.shift || key.meta || (key.ctrl && input === '\n');
      if (isNewline) {
        insertAtCursor('\n');
        return;
      }
      onSubmit(expandPlaceholders(value));
      return;
    }

    if (key.ctrl && input === 'j') {
      insertAtCursor('\n');
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
