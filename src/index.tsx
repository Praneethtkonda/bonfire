#!/usr/bin/env node
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { ModelMessage } from 'ai';
import { runAgent, initMcp, shutdownMcp } from './agent.js';

type Line =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'error'; text: string };

const MODEL = process.env.NANO_MODEL ?? 'qwen2.5-coder:latest';

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
  else if (r?.content) summary = `${r.content.length} chars`;
  else if (r?.stdout !== undefined) summary = `exit=${r.exitCode}`;
  else summary = truncate(JSON.stringify(r));
  return (
    <Text color="gray">
      {'    '}↳ {summary}
    </Text>
  );
}

function App() {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ModelMessage[]>([]);

  useInput((_, key) => {
    if (key.escape) exit();
  });

  const onSubmit = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      if (text.trim() === '/exit' || text.trim() === '/quit') {
        exit();
        return;
      }
      setInput('');
      setBusy(true);
      setLines((ls) => [...ls, { kind: 'user', text }]);

      let current = '';
      const flush = () => {
        if (current) {
          const c = current;
          current = '';
          setLines((ls) => [...ls, { kind: 'assistant', text: c }]);
        }
      };

      try {
        for await (const ev of runAgent(history, text)) {
          if (ev.type === 'text') {
            current += ev.text ?? '';
          } else if (ev.type === 'tool-call') {
            flush();
            setLines((ls) => [
              ...ls,
              { kind: 'tool', name: ev.toolName!, args: ev.args },
            ]);
          } else if (ev.type === 'tool-result') {
            setLines((ls) => [
              ...ls,
              { kind: 'tool-result', name: ev.toolName!, result: ev.result },
            ]);
          } else if (ev.type === 'error') {
            flush();
            setLines((ls) => [...ls, { kind: 'error', text: ev.error! }]);
          } else if (ev.type === 'done') {
            flush();
            setHistory(ev.result as ModelMessage[]);
          }
        }
      } catch (e: any) {
        setLines((ls) => [...ls, { kind: 'error', text: e.message ?? String(e) }]);
      }
      setBusy(false);
    },
    [busy, exit, history]
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="magenta" paddingX={1}>
        <Text>
          <Text color="magenta" bold>nano-code</Text>
          {'  '}
          <Text color="gray">model: {MODEL} · cwd: {process.cwd()} · esc to quit</Text>
        </Text>
      </Box>

      {lines.map((l, i) => {
        if (l.kind === 'user') {
          return (
            <Text key={i}>
              <Text color="green" bold>❯ </Text>
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
      })}

      <Box marginTop={1}>
        {busy ? (
          <Text color="yellow">
            <Spinner type="dots" /> thinking…
          </Text>
        ) : (
          <Box>
            <Text color="green" bold>❯ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
          </Box>
        )}
      </Box>
    </Box>
  );
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
