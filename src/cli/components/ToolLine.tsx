import React from 'react';
import { Box, Text } from 'ink';
import { truncate } from '../util.js';
import { formatDuration, glyphs, theme } from '../theme.js';
import { useColumns } from '../hooks/useColumns.js';
import { useTicker } from '../hooks/useTicker.js';
import { DiffPreview, describeDiffStats, diffStats } from './DiffPreview.js';

/**
 * Human-readable one-liner for a tool invocation, in a `verb target` register
 * rather than a raw JSON dump. Used by headless mode, which prints plain
 * lines; the interactive transcript uses `toolTitle`.
 */
export function describeCall(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof a[k] === 'string' ? (a[k] as string) : undefined;

  switch (name) {
    case 'read_file': {
      const path = str('path') ?? '';
      const offset = a.offset;
      const limit = a.limit;
      if (typeof offset === 'number' || typeof limit === 'number') {
        return `Read ${path} (from line ${offset ?? 1})`;
      }
      return `Read ${path}`;
    }
    case 'write_file':
      return `Write ${str('path') ?? ''}`;
    case 'edit_file':
      return `Edit ${str('path') ?? ''}`;
    case 'list_dir':
      return `List ${str('path') || '.'}`;
    case 'navigate':
      return `Navigate ${str('path') || '.'}`;
    case 'search': {
      const glob = str('glob');
      return `Search /${str('pattern') ?? ''}/${glob ? ` in ${glob}` : ''}`;
    }
    case 'shell':
      return `Run ${str('command') ?? ''}`;
    case 'fetch_url':
      return `Fetch ${str('url') ?? ''}`;
    case 'load_skill':
      return `Load skill ${str('name') ?? ''}`;
    case 'memory':
      return `Memory ${str('action') ?? 'save'} ${str('note') ?? str('topic') ?? ''}`.trim();
    default: {
      const json = JSON.stringify(args ?? {});
      return json === '{}' ? name : `${name} ${json}`;
    }
  }
}

/** `Read` + `src/a.ts` → rendered as `Read(src/a.ts)`. */
export function toolTitle(name: string, args: unknown): { verb: string; detail: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  const str = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '');

  switch (name) {
    case 'read_file': {
      const range =
        typeof a.offset === 'number' || typeof a.limit === 'number'
          ? ` · from line ${typeof a.offset === 'number' ? a.offset : 1}`
          : '';
      return { verb: 'Read', detail: `${str('path')}${range}` };
    }
    case 'write_file':
      return { verb: 'Write', detail: str('path') };
    case 'edit_file':
      return { verb: 'Update', detail: str('path') };
    case 'list_dir':
      return { verb: 'List', detail: str('path') || '.' };
    case 'navigate':
      return { verb: 'Navigate', detail: str('path') || '.' };
    case 'search': {
      const glob = str('glob');
      return { verb: 'Search', detail: `${str('pattern')}${glob ? ` · ${glob}` : ''}` };
    }
    case 'shell':
      return { verb: 'Bash', detail: str('command').replace(/\s*\n\s*/g, ' ⏎ ') };
    case 'fetch_url':
      return { verb: 'Fetch', detail: str('url') };
    case 'load_skill':
      return { verb: 'Skill', detail: str('name') };
    case 'memory': {
      const verb = str('action') === 'forget' ? 'Forget' : str('action') === 'read' ? 'Recall' : 'Remember';
      const text = (str('note') || str('topic')).replace(/\s+/g, ' ');
      return { verb, detail: `${str('scope') || 'repo'}${text ? ` · ${text}` : ''}` };
    }
    default: {
      const detail = Object.entries(a)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      return { verb: name, detail };
    }
  }
}

interface ToolResultShape {
  error?: string;
  status?: string;
  path?: string;
  content?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  items?: unknown[];
  totalEntries?: number;
  matches?: { path?: string }[];
  matchCount?: number;
  filesScanned?: number;
  bytes?: number;
  totalBytes?: number;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  truncated?: boolean;
  children?: unknown[];
  body?: string;
}

export interface ResultSummary {
  text: string;
  tone: 'ok' | 'warn' | 'error';
  /** A few lines of output shown under the summary. */
  preview?: string[];
  /** Output lines not shown in the preview. */
  hidden?: number;
}

const PREVIEW_LINES = 3;

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function outputLines(s: string | undefined): string[] {
  if (!s) return [];
  const lines = s.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  return lines.length === 1 && lines[0] === '' ? [] : lines;
}

/** Condense a tool result to its most useful fact plus, for output, a short preview. */
export function summarizeResult(
  result: unknown,
  call: { name?: string; args?: unknown; diff?: string } = {},
): ResultSummary {
  const r = (result ?? {}) as ToolResultShape;
  const path =
    typeof (call.args as { path?: unknown } | undefined)?.path === 'string'
      ? ((call.args as { path: string }).path)
      : (r.path ?? '');

  if (r.error) {
    const [first, ...rest] = outputLines(String(r.error));
    return {
      text: `Error: ${truncate(first ?? '', 200)}`,
      tone: 'error',
      preview: rest.slice(0, PREVIEW_LINES),
      hidden: Math.max(0, rest.length - PREVIEW_LINES),
    };
  }
  if (r.status === 'skipped') return { text: 'Declined by user', tone: 'warn' };

  if (typeof r.matchCount === 'number') {
    const files = new Set((r.matches ?? []).map((m) => m.path)).size;
    const suffix = r.truncated ? ' (truncated)' : '';
    if (r.matchCount === 0) {
      return {
        text: `No matches${r.filesScanned ? ` in ${plural(r.filesScanned, 'file')}` : ''}`,
        tone: 'warn',
      };
    }
    return {
      text: `Found ${plural(r.matchCount, 'match', 'matches')} in ${plural(files || (r.filesScanned ?? 0), 'file')}${suffix}`,
      tone: 'ok',
    };
  }

  if (typeof r.exitCode === 'number') {
    const out = outputLines(r.stdout);
    const err = outputLines(r.stderr);
    const total = out.length + err.length;
    const ok = r.exitCode === 0;
    // Success: the head of stdout is the interesting part. Failure: the tail
    // of whichever stream carries the error.
    const source = ok ? (out.length > 0 ? out : err) : err.length > 0 ? err : out;
    const preview = ok ? source.slice(0, PREVIEW_LINES) : source.slice(-PREVIEW_LINES);
    return {
      text: `Exit ${r.exitCode} · ${total === 0 ? 'no output' : plural(total, 'line')}`,
      tone: ok ? 'ok' : 'error',
      preview,
      hidden: Math.max(0, total - preview.length),
    };
  }

  if (r.status === 'written') {
    if (call.diff) {
      const { added } = diffStats(call.diff);
      return { text: `Wrote ${plural(added, 'line')} to ${path}`, tone: 'ok' };
    }
    return {
      text: `Wrote ${typeof r.bytes === 'number' ? formatBytes(r.bytes) : 'file'} to ${path}`,
      tone: 'ok',
    };
  }
  if (r.status === 'edited') {
    if (call.diff) {
      return { text: `Updated ${path} with ${describeDiffStats(diffStats(call.diff))}`, tone: 'ok' };
    }
    return { text: `Updated ${path}`, tone: 'ok' };
  }

  if (typeof r.content === 'string') {
    const lines = r.content === '' ? 0 : r.content.split('\n').length;
    if (typeof r.startLine === 'number' && typeof r.endLine === 'number') {
      return {
        text: `Read lines ${r.startLine}–${r.endLine}${r.totalLines ? ` of ${r.totalLines}` : ''}`,
        tone: 'ok',
      };
    }
    if (r.truncated) {
      return {
        text: `Read ${plural(lines, 'line')} (truncated${r.totalBytes ? `, file is ${formatBytes(r.totalBytes)}` : ''})`,
        tone: 'warn',
      };
    }
    return { text: `Read ${plural(lines, 'line')}`, tone: 'ok' };
  }

  // MCP tools answer with `content: [{ type: 'text', text }]`.
  if (Array.isArray(r.content)) {
    const text = (r.content as { type?: string; text?: string }[])
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
    const lines = outputLines(text);
    const preview = lines.slice(0, PREVIEW_LINES);
    return {
      text: lines.length === 0 ? 'Done' : `Returned ${plural(lines.length, 'line')}`,
      tone: 'ok',
      preview,
      hidden: Math.max(0, lines.length - preview.length),
    };
  }

  if (Array.isArray(r.items)) {
    const of = r.truncated && r.totalEntries ? ` of ${r.totalEntries}` : '';
    return { text: `Listed ${plural(r.items.length, 'entry', 'entries')}${of}`, tone: 'ok' };
  }
  if (Array.isArray(r.children)) {
    return { text: plural(r.children.length, 'entry', 'entries'), tone: 'ok' };
  }
  if (typeof r.body === 'string') {
    return {
      text: `Fetched ${formatBytes(Buffer.byteLength(r.body))}${r.truncated ? ' (truncated)' : ''}`,
      tone: 'ok',
    };
  }
  return { text: truncate(JSON.stringify(result ?? {}), 120), tone: 'ok' };
}

function toneColor(tone: ResultSummary['tone']): string {
  return tone === 'error' ? theme.danger : tone === 'warn' ? theme.warn : theme.muted;
}

/** `  ⎿  ` gutter plus a column for whatever hangs off the line above. */
export function ResultGutter({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Box width={5} flexShrink={0}>
        <Text color={theme.muted}>
          {'  '}
          {glyphs.result}
          {'  '}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}

function ToolHeader({
  name,
  args,
  bullet,
}: {
  name: string;
  args: unknown;
  bullet: React.ReactNode;
}) {
  const columns = useColumns();
  const { verb, detail } = toolTitle(name, args);
  const room = Math.max(10, columns - verb.length - 6);
  return (
    <Text wrap="truncate-end">
      {bullet}
      <Text bold color={theme.body}>
        {verb}
      </Text>
      {detail ? <Text color={theme.muted}>({truncate(detail, room)})</Text> : null}
    </Text>
  );
}

function SummaryBody({ summary, diff, durationMs }: {
  summary: ResultSummary;
  diff?: string;
  durationMs?: number;
}) {
  const columns = useColumns();
  const lineRoom = Math.max(20, columns - 8);
  const slow = durationMs !== undefined && durationMs >= 2000;
  return (
    <ResultGutter>
      <Text color={toneColor(summary.tone)}>
        {summary.text}
        {slow ? <Text color={theme.muted}> · {formatDuration(durationMs / 1000)}</Text> : null}
      </Text>
      {(summary.preview ?? []).map((l, i) => (
        <Text key={i} color={theme.muted} wrap="truncate-end">
          {truncate(l, lineRoom) || ' '}
        </Text>
      ))}
      {summary.hidden ? (
        <Text color={theme.muted} dimColor>
          … +{plural(summary.hidden, 'line')}
        </Text>
      ) : null}
      {diff && summary.tone === 'ok' ? (
        <DiffPreview diff={diff} maxLines={16} width={Math.max(20, columns - 6)} />
      ) : null}
    </ResultGutter>
  );
}

/** A finished tool call: header with a status-coloured bullet, then its outcome. */
export function ToolCall({
  name,
  args,
  result,
  interrupted,
  durationMs,
  diff,
}: {
  name: string;
  args: unknown;
  result?: unknown;
  interrupted?: boolean;
  durationMs?: number;
  diff?: string;
}) {
  const summary: ResultSummary | null = interrupted
    ? { text: 'Interrupted', tone: 'error' }
    : result === undefined
      ? null
      : summarizeResult(result, { name, args, diff });
  const bulletColor = !summary
    ? theme.muted
    : summary.tone === 'error'
      ? theme.danger
      : summary.tone === 'warn'
        ? theme.warn
        : theme.success;
  return (
    <Box flexDirection="column" marginTop={1}>
      <ToolHeader
        name={name}
        args={args}
        bullet={<Text color={bulletColor}>{glyphs.bullet} </Text>}
      />
      {summary ? <SummaryBody summary={summary} diff={diff} durationMs={durationMs} /> : null}
    </Box>
  );
}

/** A call still in flight: the bullet blinks and the elapsed time ticks up. */
export function RunningToolCall({
  name,
  args,
  startedAt,
  waiting,
}: {
  name: string;
  args: unknown;
  startedAt?: number;
  /** An approval prompt is open below. */
  waiting?: boolean;
}) {
  const frame = useTicker(500);
  const on = frame % 2 === 0;
  const seconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return (
    <Box flexDirection="column" marginTop={1}>
      <ToolHeader
        name={name}
        args={args}
        bullet={<Text color={on ? theme.accent : theme.muted}>{on ? glyphs.bullet : ' '} </Text>}
      />
      <ResultGutter>
        <Text color={theme.muted}>
          {waiting ? 'Waiting for approval…' : startedAt ? 'Running…' : 'Preparing…'}
          {!waiting && seconds >= 3 ? ` ${formatDuration(seconds)}` : ''}
        </Text>
      </ResultGutter>
    </Box>
  );
}

/** A result recorded without its call (older transcripts). */
export function ResultLine({ name, result }: { name: string; result: unknown }) {
  return <SummaryBody summary={summarizeResult(result, { name })} />;
}
