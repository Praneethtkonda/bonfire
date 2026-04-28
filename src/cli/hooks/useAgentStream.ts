import React, { useCallback, useState } from 'react';
import type { ModelMessage } from 'ai';
import { runAgent, type TokenUsage } from '../../agent/index.js';
import { saveSession, type Session } from '../../session/index.js';
import type { Line, UsageTotals } from '../types.js';

interface ActiveTool {
  name: string;
  args: string;
}

interface UseAgentStreamArgs {
  cwd: string;
  currentSession: Session | null;
  setCurrentSession: (s: Session) => void;
}

interface UseAgentStreamResult {
  lines: Line[];
  active: string;
  activeTool: ActiveTool | null;
  history: ModelMessage[];
  setHistory: React.Dispatch<React.SetStateAction<ModelMessage[]>>;
  appendLines: (...newLines: Line[]) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  tick: number;
  totals: UsageTotals;
  lastUsage: TokenUsage | null;
  send: (text: string) => Promise<void>;
  abort: () => void;
  setActive: (a: string) => void;
  setActiveTool: (t: ActiveTool | null) => void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAgentStream(args: UseAgentStreamArgs): UseAgentStreamResult {
  const { cwd, currentSession, setCurrentSession } = args;
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState('');
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [totals, setTotals] = useState<UsageTotals>({ input: 0, output: 0, turns: 0 });
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const abortRef = React.useRef<() => void>(() => {});

  const appendLines = useCallback((...newLines: Line[]) => {
    if (newLines.length === 0) return;
    setLines((ls) => [...ls, ...newLines]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setBusy(true);
      appendLines({ kind: 'user', text });

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

      // Expose abort
      abortRef.current = () => {
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
      };

      try {
        for await (const ev of runAgent(history, text, { signal: controller.signal })) {
          if (aborted) {
            appendLines({ kind: 'error', text: 'aborted' });
            break;
          }
          if (ev.type === 'text') {
            current += ev.text ?? '';
            setActive(current);
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
            appendLines({ kind: 'tool', name: ev.toolName!, args: ev.args });
          } else if (ev.type === 'tool-result') {
            appendLines({ kind: 'tool-result', name: ev.toolName!, result: ev.result });
            setTick((t) => t + 1);
          } else if (ev.type === 'usage') {
            const u = ev.usage!;
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
            if (currentSession) {
              const next: Session = {
                ...currentSession,
                history: updatedHistory,
                updatedAt: Date.now(),
              };
              const saved = await saveSession(cwd, next);
              setCurrentSession(next);
              appendLines({
                kind: 'assistant',
                text: `(session ${saved.slice(0, 6)} auto-saved)`,
              });
            }
          }
        }
      } catch (e: unknown) {
        if (!aborted) {
          appendLines({ kind: 'error', text: errorMessage(e) });
        }
      }
      setActive('');
      setActiveTool(null);
      setBusy(false);
    },
    [appendLines, currentSession, cwd, history, setCurrentSession],
  );

  const abort = useCallback(() => {
    abortRef.current();
  }, []);

  return {
    lines,
    active,
    activeTool,
    history,
    setHistory,
    appendLines,
    busy,
    setBusy,
    tick,
    totals,
    lastUsage,
    send,
    abort,
    setActive,
    setActiveTool,
  };
}
