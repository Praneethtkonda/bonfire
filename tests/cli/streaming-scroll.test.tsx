import React from 'react';
import { render, Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { describe, expect, it, vi } from 'vitest';
import { streamingPreview, StreamingMessage } from '../../src/cli/components/StreamingMessage.js';
import { Transcript } from '../../src/cli/components/Transcript.js';
import { useRows } from '../../src/cli/hooks/useRows.js';
import { useColumns } from '../../src/cli/hooks/useColumns.js';
import type { Line } from '../../src/cli/types.js';

describe('streaming preview', () => {
  it('shows the newest lines without modifying the complete reply', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');
    const preview = streamingPreview(text, 80, 24);
    expect(preview.truncated).toBe(true);
    expect(preview.text.split('\n')).toHaveLength(8);
    expect(preview.text).toContain('line-99');
    expect(preview.text).not.toContain('line-0');
    expect(text.split('\n')).toHaveLength(100);
  });

  it.each([5, 20, 80])('bounds long unbroken text and Unicode at width %i', (columns) => {
    const text = '界🙂long-token'.repeat(300);
    const preview = streamingPreview(text, columns, 24);
    expect(preview.truncated).toBe(true);
    expect(wrapAnsi(preview.text, columns - 2, { hard: true, trim: false }).split('\n').length)
      .toBeLessThanOrEqual(preview.limit);
  });

  it('keeps short replies intact and handles tiny viewports and CRLF', () => {
    expect(streamingPreview('hello', 80, 24)).toMatchObject({ text: 'hello', truncated: false });
    expect(streamingPreview('one\r\ntwo\r\nthree', 80, 3)).toMatchObject({
      text: 'three', limit: 1, truncated: true,
    });
  });
});

function StreamingHarness({ text, lines = [] }: { text: string; lines?: Line[] }) {
  const rows = useRows();
  const columns = useColumns();
  return (
    <Box flexDirection="column">
      <Transcript lines={lines} />
      <Box flexDirection="column" maxHeight={Math.max(1, rows - 1)} overflow="hidden">
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {text ? <StreamingMessage text={text} rows={rows} columns={columns} /> : null}
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          <Text>Generating · Esc to interrupt</Text>
          <Text>&gt; input remains available</Text>
        </Box>
      </Box>
    </Box>
  );
}

describe('interactive terminal scrollback', () => {
  it('does not clear the terminal during long streams or resize and commits the full reply once', async () => {
    const stdout = process.stdout;
    const properties = ['isTTY', 'columns', 'rows'];
    const descriptors = properties.map((key) => Object.getOwnPropertyDescriptor(stdout, key));
    Object.defineProperties(stdout, {
      isTTY: { value: true, configurable: true },
      columns: { value: 40, writable: true, configurable: true },
      rows: { value: 24, writable: true, configurable: true },
    });
    let output = '';
    const write = vi.spyOn(stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    const ui = render(<StreamingHarness text="" />, {
      stdout, interactive: true, exitOnCtrlC: false, maxFps: 1000, patchConsole: false,
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    try {
      let text = '';
      for (let i = 0; i < 30; i++) {
        text += `reply-${i}: ${'long-word-'.repeat(12)}\n`;
        ui.rerender(<StreamingHarness text={text} />);
        await settle();
      }
      expect(output).not.toMatch(/\u001b\[(?:2J|3J)/);
      expect(output.match(/reply-0:/g)).toHaveLength(1);
      stdout.rows = 12; stdout.columns = 20; stdout.emit('resize');
      await settle();
      output = '';
      ui.rerender(<StreamingHarness text={text} />);
      await settle();
      expect(output).not.toMatch(/\u001b\[(?:2J|3J)/);
      const complete: Line[] = [{ kind: 'assistant', text }];
      ui.rerender(<StreamingHarness text="" lines={complete} />);
      await settle();
      const afterCommit = output;
      ui.rerender(<StreamingHarness text="" lines={complete} />);
      await settle();
      expect(output).toBe(afterCommit);
      expect(output.match(/reply-0:/g)).toHaveLength(1);
      expect(output).toContain('reply-29:');
      expect(output).not.toMatch(/\u001b\[(?:2J|3J)/);
    } finally {
      ui.unmount();
      write.mockRestore();
      properties.forEach((key, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(stdout, key, descriptor);
        else Reflect.deleteProperty(stdout, key);
      });
    }
  });
});
