import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

export interface DiffRow {
  kind: 'add' | 'remove' | 'context' | 'gap';
  /** New-file line number for additions and context, old-file for removals. */
  lineNo?: number;
  text: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse a unified diff into numbered rows, dropping the file headers. */
export function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      if (inHunk) rows.push({ kind: 'gap', text: '' });
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith('\\')) continue;
    const text = raw.slice(1).replace(/\t/g, '    ');
    if (raw.startsWith('+')) rows.push({ kind: 'add', lineNo: newNo++, text });
    else if (raw.startsWith('-')) rows.push({ kind: 'remove', lineNo: oldNo++, text });
    else if (raw.startsWith(' ')) {
      rows.push({ kind: 'context', lineNo: newNo, text });
      oldNo++;
      newNo++;
    }
  }
  // A diff without hunk headers (a bare snippet): show it unnumbered.
  if (!inHunk) {
    return diff
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith('---') && !l.startsWith('+++'))
      .map((l): DiffRow => ({
        kind: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'remove' : 'context',
        text: (/^[+\- ]/.test(l) ? l.slice(1) : l).replace(/\t/g, '    '),
      }));
  }
  return rows;
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of parseDiff(diff)) {
    if (r.kind === 'add') added++;
    else if (r.kind === 'remove') removed++;
  }
  return { added, removed };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "2 additions and 1 removal" — the phrasing shown under an edit. */
export function describeDiffStats({ added, removed }: { added: number; removed: number }): string {
  if (added === 0 && removed === 0) return 'no changes';
  if (removed === 0) return plural(added, 'addition');
  if (added === 0) return plural(removed, 'removal');
  return `${plural(added, 'addition')} and ${plural(removed, 'removal')}`;
}

/**
 * Line-numbered diff with tinted rows: removals on red, additions on green,
 * context in the plain foreground. The `+`/`-` sign stays in each row so the
 * diff still reads correctly without colour or when copied out.
 */
export function DiffPreview({
  diff,
  maxLines = 40,
  width,
}: {
  diff: string;
  maxLines?: number;
  /** Pad tinted rows to this many columns so the tint spans the panel. */
  width?: number;
}) {
  const rows = parseDiff(diff);
  const shown = rows.slice(0, maxLines);
  const hidden = rows.length - shown.length;
  const numWidth = Math.max(
    1,
    ...shown.map((r) => (r.lineNo === undefined ? 0 : String(r.lineNo).length)),
  );
  const blank = ' '.repeat(numWidth);

  return (
    <Box flexDirection="column">
      {shown.map((r, i) => {
        if (r.kind === 'gap') {
          return (
            <Text key={i} color={theme.muted}>
              {blank} ⋮
            </Text>
          );
        }
        const num = r.lineNo === undefined ? blank : String(r.lineNo).padStart(numWidth);
        if (r.kind === 'context') {
          return (
            <Text key={i}>
              <Text color={theme.muted}>{num}   </Text>
              <Text color={theme.body}>{r.text || ' '}</Text>
            </Text>
          );
        }
        const sign = r.kind === 'add' ? '+' : '-';
        let row = `${num} ${sign} ${r.text}`;
        if (width && row.length < width) row = row.padEnd(width);
        const bg = r.kind === 'add' ? theme.diffAddedBg : theme.diffRemovedBg;
        const fg = bg ? theme.diffText : r.kind === 'add' ? theme.success : theme.danger;
        return (
          <Text key={i} backgroundColor={bg} color={fg}>
            {row}
          </Text>
        );
      })}
      {hidden > 0 ? (
        <Text color={theme.muted}>
          {blank} … +{plural(hidden, 'line')}
        </Text>
      ) : null}
    </Box>
  );
}
