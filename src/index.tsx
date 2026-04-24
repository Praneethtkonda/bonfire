#!/usr/bin/env node
import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { ModelMessage } from 'ai';
import {
  runAgent,
  initMcp,
  shutdownMcp,
  describeProvider,
  type TokenUsage,
} from './agent.js';
import {
  setApprovalHandler,
  changedFiles,
  addAllowedDir,
  getAllowedDirs,
  type ApprovalRequest,
} from './tools.js';

type Line =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'error'; text: string };

function truncate(s: string, n = 200) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function ToolLine({ name, args }: { name: string; args: unknown }) {
  const summary = truncate(JSON.stringify(args));
  return (
    <Text color="cyan">
      {'  '}● {name}({summary})
    </Text>
  );
}

function ResultLine({ name, result }: { name: string; result: unknown }) {
  const r = result as any;
  let summary: string;
  if (r?.error) summary = `error: ${r.error}`;
  else if (r?.status === 'skipped') summary = 'skipped by user';
  else if (r?.content) summary = `${r.content.length} chars`;
  else if (r?.stdout !== undefined) summary = `exit=${r.exitCode}`;
  else summary = truncate(JSON.stringify(r));
  return (
    <Text color="gray">
      {'    '}↳ {summary}
    </Text>
  );
}

function DiffPreview({ diff }: { diff: string }) {
  const rawLines = diff.split('\n');
  const start = rawLines.findIndex((l) => l.startsWith('@@'));
  const body = start === -1 ? rawLines : rawLines.slice(start);
  const shown = body.slice(0, 40);
  const hidden = body.length - shown.length;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      {shown.map((l, i) => {
        let color: string | undefined;
        if (l.startsWith('+')) color = 'green';
        else if (l.startsWith('-')) color = 'red';
        else if (l.startsWith('@@')) color = 'cyan';
        return (
          <Text key={i} color={color}>
            {l || ' '}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text color="gray" dimColor>
          … {hidden} more line(s)
        </Text>
      )}
    </Box>
  );
}

function ModifiedFilesPanel({ tick }: { tick: number }) {
  if (changedFiles.size === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text color="gray" bold>
        Modified files ({changedFiles.size})
      </Text>
      {Array.from(changedFiles.entries()).map(([p, c]) => (
        <Text key={`${p}:${tick}`} color="gray">
          {'  '}
          {p}
          {'  '}
          <Text color="green">{c.writes}w</Text>
          {' '}
          <Text color="yellow">{c.edits}e</Text>
          {' '}
          <Text color="gray" dimColor>
            {c.bytes}b
          </Text>
        </Text>
      ))}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState('');
  const [activeTool, setActiveTool] = useState<{ name: string; args: string } | null>(
    null
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [pending, setPending] = useState<{
    req: ApprovalRequest;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const [usage, setUsage] = useState({ input: 0, output: 0, turns: 0 });
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const [providerLabel, setProviderLabel] = useState<string>('…');

  useEffect(() => {
    describeProvider().then(setProviderLabel).catch(() => {
      setProviderLabel('unknown');
    });
  }, []);

  useEffect(() => {
    setApprovalHandler(
      (req) =>
        new Promise<boolean>((resolve) => {
          setPending({ req, resolve });
        })
    );
    return () => setApprovalHandler(null);
  }, []);

  useInput((ch, key) => {
    if (pending) {
      if (ch === 'y' || ch === 'Y' || key.return) {
        pending.resolve(true);
        setPending(null);
      } else if (ch === 'n' || ch === 'N' || key.escape) {
        pending.resolve(false);
        setPending(null);
      }
      return;
    }
    if (key.escape) exit();
  });

  const onSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      const trimmed = text.trim();
      if (trimmed === '/exit' || trimmed === '/quit') {
        exit();
        return;
      }
      if (trimmed === '/dirs') {
        setInput('');
        const dirs = getAllowedDirs();
        setLines((ls) => [
          ...ls,
          { kind: 'user', text },
          {
            kind: 'assistant',
            text: `Allowed directories (${dirs.length}):\n${dirs
              .map((d, i) => `  ${i === 0 ? '*' : '+'} ${d}`)
              .join('\n')}`,
          },
        ]);
        return;
      }
      if (trimmed.startsWith('/add-dir ')) {
        setInput('');
        const arg = trimmed.slice('/add-dir '.length).trim();
        try {
          const added = await addAllowedDir(arg);
          setLines((ls) => [
            ...ls,
            { kind: 'user', text },
            { kind: 'assistant', text: `Added allowed directory: ${added}` },
          ]);
        } catch (e: any) {
          setLines((ls) => [
            ...ls,
            { kind: 'user', text },
            { kind: 'error', text: e.message ?? String(e) },
          ]);
        }
        return;
      }
      setInput('');
      setBusy(true);
      setLines((ls) => [...ls, { kind: 'user', text }]);

      let current = '';
      const flushText = () => {
        if (current) {
          const c = current;
          current = '';
          setLines((ls) => [...ls, { kind: 'assistant', text: c }]);
          setActive('');
        }
      };

      try {
        for await (const ev of runAgent(history, text)) {
          if (ev.type === 'text') {
            current += ev.text ?? '';
            setActive(current);
          } else if (ev.type === 'tool-input-start') {
            setActiveTool({ name: ev.toolName ?? '', args: '' });
          } else if (ev.type === 'tool-input-delta') {
            setActiveTool((prev) =>
              prev
                ? { ...prev, args: prev.args + (ev.delta ?? '') }
                : { name: ev.toolName ?? '', args: ev.delta ?? '' }
            );
          } else if (ev.type === 'tool-call') {
            flushText();
            setActiveTool(null);
            setLines((ls) => [
              ...ls,
              { kind: 'tool', name: ev.toolName!, args: ev.args },
            ]);
          } else if (ev.type === 'tool-result') {
            setLines((ls) => [
              ...ls,
              { kind: 'tool-result', name: ev.toolName!, result: ev.result },
            ]);
            setTick((t) => t + 1);
          } else if (ev.type === 'usage') {
            const u = ev.usage!;
            setLastUsage(u);
            setUsage((prev) => ({
              input: prev.input + u.input,
              output: prev.output + u.output,
              turns: prev.turns + 1,
            }));
          } else if (ev.type === 'error') {
            flushText();
            setLines((ls) => [...ls, { kind: 'error', text: ev.error! }]);
          } else if (ev.type === 'done') {
            flushText();
            setHistory(ev.result as ModelMessage[]);
          }
        }
      } catch (e: any) {
        setLines((ls) => [...ls, { kind: 'error', text: e.message ?? String(e) }]);
      }
      setActive('');
      setActiveTool(null);
      setBusy(false);
    },
    [busy, exit, history]
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="blue" paddingX={1}>
        <Text>
          <Text color="blue" bold>
            nano-code
          </Text>
          {'  '}
          <Text color="gray">
            {providerLabel} · cwd: {process.cwd()} · esc to quit
          </Text>
        </Text>
      </Box>

      <Static items={lines}>
        {(l: Line, i: number) => {
          if (l.kind === 'user') {
            return (
              <Text key={i}>
                <Text color="green" bold>
                  ❯{' '}
                </Text>
                {l.text}
              </Text>
            );
          }
          if (l.kind === 'assistant') {
            return (
              <Text key={i} color="white">
                {l.text}
              </Text>
            );
          }
          if (l.kind === 'tool') {
            return <ToolLine key={i} name={l.name} args={l.args} />;
          }
          if (l.kind === 'tool-result') {
            return <ResultLine key={i} name={l.name} result={l.result} />;
          }
          return (
            <Text key={i} color="red">
              ! {l.text}
            </Text>
          );
        }}
      </Static>

      {active ? <Text color="white">{active}</Text> : null}

      {activeTool ? (
        <Text color="cyan" dimColor>
          {'  '}● {activeTool.name}({truncate(activeTool.args, 120)})
        </Text>
      ) : null}

      <ModifiedFilesPanel tick={tick} />

      {usage.turns > 0 ? (
        <Text color="gray" dimColor>
          tokens · in {usage.input.toLocaleString()} · out{' '}
          {usage.output.toLocaleString()} · total{' '}
          {(usage.input + usage.output).toLocaleString()} · {usage.turns} turn
          {usage.turns === 1 ? '' : 's'}
          {lastUsage
            ? ` · last +${lastUsage.input}/${lastUsage.output}`
            : ''}
        </Text>
      ) : null}

      {pending ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            {pending.req.tool} → {pending.req.path}
          </Text>
          <DiffPreview diff={pending.req.diff} />
        </Box>
      ) : null}

      <Box marginTop={1}>
        {pending ? (
          <Text color="yellow">
            Apply changes? <Text bold>y</Text> = yes (enter), <Text bold>n</Text> = no (esc)
          </Text>
        ) : busy ? (
          <Text color="yellow">
            <Spinner type="dots" /> thinking…
          </Text>
        ) : (
          <Box>
            <Text color="green" bold>
              ❯{' '}
            </Text>
            <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

if (!process.stdin.isTTY) {
  const hint =
    process.platform === 'win32'
      ? 'On Git Bash / MSYS, run `winpty nano-code`, or use Windows Terminal or PowerShell directly.'
      : 'Run from a real terminal (not piped stdin).';
  console.error(`nano-code requires an interactive TTY.\n${hint}`);
  process.exit(1);
}

const mcpToolCount = await initMcp();
if (mcpToolCount > 0) {
  console.error(`[mcp] ${mcpToolCount} tool(s) available`);
}

const app = render(<App />);

const cleanup = async () => {
  await shutdownMcp();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
app.waitUntilExit().then(cleanup);
