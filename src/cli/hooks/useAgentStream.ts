import React, { useCallback, useState } from 'react';
import type { ModelMessage } from 'ai';
import { runAgent, type TokenUsage, type ContextStatus } from '../../agent/index.js';
import { formatProviderError } from '../../agent/error-format.js';
import { createSession, saveSession, type Session } from '../../session/index.js';
import type { Line, UsageTotals } from '../types.js';
import { takeDiff } from '../diff-stash.js';

interface ActiveTool {
  name: string;
  args: string;
}

/** A tool call that has been made but has not returned yet. */
export interface RunningTool {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
}

/** Turns shorter than this end without a "Worked for …" line. */
const TURN_SUMMARY_MIN_SECONDS = 5;

interface UseAgentStreamArgs {
  cwd: string;
  providerLabel: string;
  currentSession: Session | null;
  setCurrentSession: (s: Session) => void;
}

interface UseAgentStreamResult {
  lines: Line[];
  active: string;
  reasoning: string;
  activeTool: ActiveTool | null;
  runningTools: RunningTool[];
  /** Characters streamed since the last usage report — a live token estimate. */
  streamedChars: number;
  history: ModelMessage[];
  setHistory: React.Dispatch<React.SetStateAction<ModelMessage[]>>;
  appendLines: (...newLines: Line[]) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  tick: number;
  totals: UsageTotals;
  lastUsage: TokenUsage | null;
  context: ContextStatus | null;
  setContext: (c: ContextStatus | null) => void;
  send: (text: string) => Promise<void>;
  abort: () => void;
  setActive: (a: string) => void;
  setActiveTool: (t: ActiveTool | null) => void;
  clearTranscript: () => void;
}

export function useAgentStream(args: UseAgentStreamArgs): UseAgentStreamResult {
  const { cwd, providerLabel, currentSession, setCurrentSession } = args;
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
  const [streamedChars, setStreamedChars] = useState(0);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [totals, setTotals] = useState<UsageTotals>({ input: 0, output: 0, turns: 0 });
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const [context, setContext] = useState<ContextStatus | null>(null);
  const abortRef = React.useRef<() => void>(() => {});

  const appendLines = useCallback((...newLines: Line[]) => {
    if (newLines.length === 0) return;
    setLines((ls) => [...ls, ...newLines]);
  }, []);

  const clearTranscript = useCallback(() => {
    setLines([]);
    setActive('');
    setReasoning('');
    setActiveTool(null);
    setRunningTools([]);
    setTotals({ input: 0, output: 0, turns: 0 });
    setLastUsage(null);
    setContext(null);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setBusy(true);
      setStreamedChars(0);
      appendLines({ kind: 'user', text });

      // Sessions are created lazily on the first turn so every conversation is
      // persisted without the user having to run `/sessions new` first.
      let session = currentSession;
      if (!session) {
        session = await createSession(cwd, { cwd, provider: providerLabel });
        setCurrentSession(session);
      }

      let current = '';
      const flushText = () => {
        if (!current) return;
        const c = current;
        current = '';
        appendLines({ kind: 'assistant', text: c });
        setActive('');
      };

      const controller = new AbortController();
      let aborted = false;
      const turnStartedAt = Date.now();
      let turnOutputTokens = 0;

      // Calls in flight for this turn. A local list (mirrored into state for
      // rendering) so a result can be matched to its call synchronously.
      let running: RunningTool[] = [];
      const setRunning = (next: RunningTool[]) => {
        running = next;
        setRunningTools(next);
      };
      const finishTool = (
        id: string | undefined,
        name: string,
        outcome: { result?: unknown; interrupted?: boolean },
      ) => {
        const idx = running.findIndex((t) => (id ? t.id === id : t.name === name));
        const call = idx === -1 ? undefined : running[idx];
        if (idx !== -1) setRunning(running.filter((_, i) => i !== idx));
        const args = call?.args ?? {};
        const path = (args as { path?: unknown }).path;
        const diff =
          (name === 'edit_file' || name === 'write_file') && typeof path === 'string'
            ? takeDiff(path)
            : undefined;
        appendLines({
          kind: 'tool',
          name: call?.name ?? name,
          args,
          ...outcome,
          durationMs: call ? Date.now() - call.startedAt : undefined,
          diff,
        });
      };
      const interruptRunning = () => {
        for (const t of running) finishTool(t.id, t.name, { interrupted: true });
      };

      abortRef.current = () => {
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
      };

      try {
        for await (const ev of runAgent(history, text, { signal: controller.signal })) {
          if (aborted) break;
          if (ev.type === 'text') {
            setReasoning('');
            current += ev.text ?? '';
            setActive(current);
            setStreamedChars((n) => n + (ev.text?.length ?? 0));
          } else if (ev.type === 'reasoning') {
            setReasoning((r) => (r + (ev.text ?? '')).slice(-500));
            setStreamedChars((n) => n + (ev.text?.length ?? 0));
          } else if (ev.type === 'tool-input-start') {
            setActiveTool({ name: ev.toolName ?? '', args: '' });
          } else if (ev.type === 'tool-input-delta') {
            setActiveTool((prev) =>
              prev
                ? { ...prev, args: prev.args + (ev.delta ?? '') }
                : { name: ev.toolName ?? '', args: ev.delta ?? '' },
            );
          } else if (ev.type === 'tool-call') {
            flushText();
            setActiveTool(null);
            setRunning([
              ...running,
              {
                id: ev.toolCallId ?? `${ev.toolName}-${running.length}-${Date.now()}`,
                name: ev.toolName!,
                args: ev.args,
                startedAt: Date.now(),
              },
            ]);
          } else if (ev.type === 'tool-result') {
            finishTool(ev.toolCallId, ev.toolName!, { result: ev.result });
            setTick((t) => t + 1);
          } else if (ev.type === 'tool-error') {
            setActiveTool(null);
            finishTool(ev.toolCallId, ev.toolName ?? 'tool', { result: { error: ev.error } });
          } else if (ev.type === 'context') {
            if (ev.context) setContext(ev.context);
          } else if (ev.type === 'compaction') {
            const c = ev.compaction!;
            const bits: string[] = [];
            if (c.droppedMessages > 0) {
              bits.push(
                `${c.droppedMessages} old messages ${c.summarised ? 'summarised' : 'dropped'}`,
              );
            }
            if (c.trimmedToolOutputs > 0) {
              bits.push(`${c.trimmedToolOutputs} tool outputs trimmed`);
            }
            appendLines({
              kind: 'notice',
              text: `context compacted · ${bits.join(' · ')} · ~${c.tokensBefore} → ~${c.tokensAfter} tokens`,
            });
          } else if (ev.type === 'notice') {
            flushText();
            appendLines({ kind: 'notice', text: ev.text ?? '' });
          } else if (ev.type === 'abort') {
            flushText();
          } else if (ev.type === 'usage') {
            const u = ev.usage!;
            turnOutputTokens += u.output;
            setStreamedChars(0);
            setLastUsage(u);
            setTotals((prev) => ({
              input: prev.input + u.input,
              output: prev.output + u.output,
              turns: prev.turns + 1,
            }));
          } else if (ev.type === 'error') {
            flushText();
            appendLines({ kind: 'error', text: ev.error! });
          } else if (ev.type === 'done') {
            flushText();
            const updatedHistory = ev.result as ModelMessage[];
            setHistory(updatedHistory);
            const next: Session = {
              ...session,
              history: updatedHistory,
              updatedAt: Date.now(),
            };
            try {
              await saveSession(cwd, next);
              setCurrentSession(next);
            } catch (e: unknown) {
              // Persistence failing must never lose the in-memory turn.
              appendLines({
                kind: 'error',
                text: `could not save session: ${
                  e instanceof Error ? e.message : String(e)
                }`,
              });
            }
          }
        }
      } catch (e: unknown) {
        if (!aborted) {
          appendLines({ kind: 'error', text: formatProviderError(e) });
        }
      }
      if (aborted) flushText();
      interruptRunning();
      if (aborted) {
        appendLines({ kind: 'interrupted' });
      } else {
        const seconds = Math.floor((Date.now() - turnStartedAt) / 1000);
        if (seconds >= TURN_SUMMARY_MIN_SECONDS) {
          appendLines({ kind: 'turn-summary', seconds, outputTokens: turnOutputTokens });
        }
      }
      setActive('');
      setReasoning('');
      setActiveTool(null);
      setBusy(false);
    },
    [appendLines, currentSession, cwd, history, providerLabel, setCurrentSession],
  );

  const abort = useCallback(() => {
    abortRef.current();
  }, []);

  return {
    lines,
    active,
    reasoning,
    activeTool,
    runningTools,
    streamedChars,
    history,
    setHistory,
    appendLines,
    busy,
    setBusy,
    tick,
    totals,
    lastUsage,
    context,
    setContext,
    send,
    abort,
    setActive,
    setActiveTool,
    clearTranscript,
  };
}
