import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

/**
 * A small Markdown renderer for assistant replies: headings, paragraphs,
 * bullet and numbered lists, block quotes, fenced code, tables, rules, and
 * inline bold / italic / `code` / links. It is deliberately forgiving — a
 * reply is rendered while it streams, so an unclosed fence or a half-written
 * table must still render sensibly. Single newlines inside a paragraph are
 * kept, because models use them for layout far more often than for prose.
 */

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' };

export interface ListItem {
  depth: number;
  marker: string;
  text: string;
}

const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 1;
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) blocks.push({ type: 'paragraph', text: para.join('\n') });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or end of input while streaming)
      blocks.push({ type: 'code', lang: fence[2] ?? '', lines: dedent(body) });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (RULE_RE.test(line)) {
      flushPara();
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (LIST_RE.test(line)) {
      flushPara();
      const items: ListItem[] = [];
      const baseIndent = LIST_RE.exec(line)![1].length;
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m) {
          const depth = Math.max(0, Math.floor((m[1].length - baseIndent) / 2));
          items.push({ depth, marker: m[2], text: m[3] });
          i++;
          continue;
        }
        // An indented line continues the previous item.
        if (items.length > 0 && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].text += `\n${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i]);
        if (!q) break;
        body.push(q[1]);
        i++;
      }
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((l) => l.slice(min)) : lines;
}

// ── inline ──────────────────────────────────────────────────────────────────

type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; children: Span[] }
  | { kind: 'italic'; children: Span[] }
  | { kind: 'strike'; children: Span[] }
  | { kind: 'link'; text: string; url: string };

const INLINE_RE =
  /(`+)([^`]+?)\1|\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|__(?=\S)([\s\S]+?)(?<=\S)__|~~(?=\S)([\s\S]+?)(?<=\S)~~|(?<![\w*])\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?![\w_])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ kind: 'text', text: text.slice(last, at) });
    if (m[2] !== undefined) spans.push({ kind: 'code', text: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) {
      spans.push({ kind: 'bold', children: parseInline(m[3] ?? m[4]) });
    } else if (m[5] !== undefined) spans.push({ kind: 'strike', children: parseInline(m[5]) });
    else if (m[6] !== undefined || m[7] !== undefined) {
      spans.push({ kind: 'italic', children: parseInline(m[6] ?? m[7]) });
    } else if (m[8] !== undefined) spans.push({ kind: 'link', text: m[8], url: m[9] });
    last = at + m[0].length;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans;
}

/** Plain text of an inline string, markers removed — used to size table cells. */
export function stripInline(text: string): string {
  return parseInline(text)
    .map(function plain(s: Span): string {
      switch (s.kind) {
        case 'text':
        case 'code':
          return s.text;
        case 'link':
          return s.text;
        default:
          return s.children.map(plain).join('');
      }
    })
    .join('');
}

function renderSpans(spans: Span[]): React.ReactNode[] {
  return spans.map((s, i) => {
    switch (s.kind) {
      case 'text':
        return <React.Fragment key={i}>{s.text}</React.Fragment>;
      case 'code':
        return (
          <Text key={i} color={theme.code}>
            {s.text}
          </Text>
        );
      case 'bold':
        return (
          <Text key={i} bold>
            {renderSpans(s.children)}
          </Text>
        );
      case 'italic':
        return (
          <Text key={i} italic>
            {renderSpans(s.children)}
          </Text>
        );
      case 'strike':
        return (
          <Text key={i} strikethrough>
            {renderSpans(s.children)}
          </Text>
        );
      case 'link':
        return (
          <Text key={i}>
            <Text color={theme.accent} underline>
              {s.text}
            </Text>
            {s.text !== s.url ? <Text color={theme.muted}> ({s.url})</Text> : null}
          </Text>
        );
    }
  });
}

export function Inline({ text, color }: { text: string; color?: string }) {
  return <Text color={color ?? theme.body}>{renderSpans(parseInline(text))}</Text>;
}

// ── blocks ──────────────────────────────────────────────────────────────────

function bulletFor(item: ListItem): string {
  if (/^\d/.test(item.marker)) return item.marker.replace(')', '.');
  return item.depth === 0 ? '•' : item.depth === 1 ? '◦' : '▪';
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text bold underline={block.level === 1} color={theme.body}>
          {renderSpans(parseInline(block.text))}
        </Text>
      );
    case 'paragraph':
      return <Inline text={block.text} />;
    case 'code':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {block.lines.length === 0 ? <Text> </Text> : null}
          {block.lines.map((l, i) => (
            <Text key={i}>
              <Text color={theme.muted}>│ </Text>
              <Text color={theme.body}>{l || ' '}</Text>
            </Text>
          ))}
        </Box>
      );
    case 'list': {
      const markerWidth = Math.max(...block.items.map((it) => bulletFor(it).length));
      return (
        <Box flexDirection="column">
          {block.items.map((item, i) => (
            <Box key={i} paddingLeft={item.depth * 2}>
              <Box width={markerWidth + 1} flexShrink={0}>
                <Text color={theme.muted}>{bulletFor(item)}</Text>
              </Box>
              <Box flexGrow={1}>
                <Inline text={item.text} />
              </Box>
            </Box>
          ))}
        </Box>
      );
    }
    case 'quote':
      return (
        <Box>
          <Box flexShrink={0}>
            <Text color={theme.muted}>▎ </Text>
          </Box>
          <Inline text={block.text} color={theme.muted} />
        </Box>
      );
    case 'table':
      return <TableView header={block.header} rows={block.rows} />;
    case 'rule':
      return <Text color={theme.muted}>{'─'.repeat(40)}</Text>;
  }
}

function TableView({ header, rows }: { header: string[]; rows: string[][] }) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  const cell = (r: string[], c: number) => stripInline(r[c] ?? '');
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(cell(header, c).length, ...rows.map((r) => cell(r, c).length), 1),
  );
  const line = (r: string[]) => widths.map((w, c) => cell(r, c).padEnd(w)).join(' │ ');
  return (
    <Box flexDirection="column">
      <Text bold color={theme.body}>
        {line(header)}
      </Text>
      <Text color={theme.muted}>{widths.map((w) => '─'.repeat(w)).join('─┼─')}</Text>
      {rows.map((r, i) => (
        <Text key={i} color={theme.body}>
          {line(r)}
        </Text>
      ))}
    </Box>
  );
}

/** Render a Markdown string as a column of blocks separated by blank lines. */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <Box key={i} marginTop={i > 0 ? 1 : 0} flexDirection="column">
          <BlockView block={b} />
        </Box>
      ))}
    </Box>
  );
}
