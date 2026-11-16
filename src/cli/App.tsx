import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp, useInput } from 'ink';
import { getContextSettings } from '../agent/context';
import { resetProvider, describeProvider } from '../agent/index';
import type { Session } from '../session/index';
import type { ApprovalDecision } from '../tools/index';
import type { CodemapProgress } from './types';
import { runSlashCommand, suggestCommands } from './commands/index';
import { useApproval } from './hooks/useApproval';
import { useProvider } from './hooks/useProvider';
import { useAgentStream } from './hooks/useAgentStream';
import { useThinkingPhrase } from './hooks/useThinkingPhrase';
import { useElapsed } from './hooks/useElapsed';
import { useThemeVersion } from './hooks/useTheme';
import { Banner } from './components/Banner';
import { Transcript } from './components/Transcript';
import { StreamingMessage } from './components/StreamingMessage';
import { useRows } from './hooks/useRows';
import { useColumns } from './hooks/useColumns';
import { ModifiedFilesPanel } from './components/ModifiedFilesPanel';
import { ApprovalPrompt, approvalOptions } from './components/ApprovalPrompt';
import { InputBox } from './components/InputBox';
import { Footer, Shortcuts } from './components/Footer';
import { Spinner } from './components/Spinner';
import { CommandSuggestions } from './components/CommandSuggestions';
import { ReconfigurePrompt } from './components/ReconfigurePrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RunningToolCall } from './components/ToolLine';
import type { KeyMeta } from './components/MultilineInput';
import { stashDiff } from './diff-stash';
import {
  loadConfig,
  saveConfig,
  clearConfigCache,
  DEFAULT_CONFIG,
  type NanoConfig,
} from '../config';

const PLACEHOLDERS = [
  'Try "fix the failing test"',
  'Try "explain how this project is structured"',
  'Try "add input validation to the signup handler"',
  'Try "write a test for the date parser"',
];

export interface AppProps {
  /** When true, the app opens the reconfigure prompt on first paint (used for first-run onboarding). */
  firstRun?: boolean;
  version?: string;
}

export function App({ firstRun = false }: AppProps) {
  const { exit } = useApp();
  const cwd = process.cwd();
  const rows = useRows();
  const columns = useColumns();
  const { pending, decide } = useApproval();

  const [input, setInput] = useState('');
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [codemapProgress, setCodemapProgress] = useState<CodemapProgress | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [approvalIndex, setApprovalIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [reconfigureMode, setReconfigureMode] = useState(false);
  const [existingConfig, setExistingConfig] = useState<NanoConfig | null>(null);
  const [providerKey, setProviderKey] = useState(0);
  const [compactThreshold, setCompactThreshold] = useState<number | null>(0.75);
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)],
  );

  const providerLabel = useProvider(providerKey);

  const stream = useAgentStream({ cwd, providerLabel, currentSession, setCurrentSession });
  const runningToolName =
    stream.runningTools.at(-1)?.name ?? stream.activeTool?.name ?? null;
  const thinkingPhrase = useThinkingPhrase(stream.busy, runningToolName);
  const elapsed = useElapsed(stream.busy);
  useThemeVersion();

  // The footer's "context left until auto-compact" needs the configured
  // threshold; null when auto-compaction is switched off.
  useEffect(() => {
    let live = true;
    getContextSettings()
      .then((s) => {
        if (live) setCompactThreshold(s.autoCompact ? s.compactThreshold : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Output tokens already counted when this turn began, so the spinner shows
  // only the current turn's.
  const outputAtStart = useRef(0);
  const wasBusy = useRef(false);
  if (stream.busy && !wasBusy.current) outputAtStart.current = stream.totals.output;
  wasBusy.current = stream.busy;
  const turnTokens =
    Math.max(0, stream.totals.output - outputAtStart.current) +
    Math.round(stream.streamedChars / 4);

  // Abort hook for long-running slash commands (e.g. /codemap build). The
  // command registers its abort fn here; the Esc handler invokes it so the
  // work actually stops instead of leaving a zombie loop pushing progress.
  const commandAbortRef = useRef<(() => void) | null>(null);
  const registerAbort = useCallback((abort: (() => void) | null) => {
    commandAbortRef.current = abort;
  }, []);

  // History lives in the stream hook; commands need to read it synchronously.
  const historyRef = useRef(stream.history);
  historyRef.current = stream.history;
  const getHistory = useCallback(() => historyRef.current, []);

  useEffect(() => {
    if (!firstRun) return;
    setExistingConfig(DEFAULT_CONFIG);
    setReconfigureMode(true);
  }, [firstRun]);

  const enterReconfigure = async () => {
    const config = await loadConfig();
    setExistingConfig(config);
    setReconfigureMode(true);
  };

  const suggestions = useMemo(() => suggestCommands(input), [input]);
  useEffect(() => {
    if (suggestionIndex >= suggestions.length) setSuggestionIndex(0);
  }, [suggestions.length, suggestionIndex]);

  // Each new approval prompt starts on "Yes".
  useEffect(() => {
    setApprovalIndex(0);
  }, [pending]);

  const choose = (decision: ApprovalDecision) => {
    if (!pending) return;
    const req = pending.req;
    // Keep the approved diff so the transcript can show it under the result.
    if (decision !== 'no' && (req.tool === 'edit_file' || req.tool === 'write_file')) {
      stashDiff(req.path, req.diff);
    }
    decide(decision);
  };

  // Approval and global escape live above the input — they fire even while the
  // multiline input is hidden.
  useInput((ch, key) => {
    if (pending) {
      const options = approvalOptions(pending.req);
      const n = options.length;
      if (key.upArrow) setApprovalIndex((i) => (i - 1 + n) % n);
      else if (key.downArrow || key.tab) setApprovalIndex((i) => (i + 1) % n);
      else if (key.return) choose(options[Math.min(approvalIndex, n - 1)].decision);
      else if (/^[1-9]$/.test(ch) && Number(ch) <= n) choose(options[Number(ch) - 1].decision);
      else if (ch === 'y' || ch === 'Y') choose('yes');
      else if (ch === 'a' || ch === 'A') {
        if (options.some((o) => o.decision === 'always')) choose('always');
      } else if (ch === 'n' || ch === 'N' || key.escape) choose('no');
      return;
    }
    // Esc precedence: abort while busy → close shortcuts → clear pending input → exit when idle.
    if (key.escape) {
      if (stream.busy) {
        // A slash command (e.g. /codemap build) registers its own abort. Fire
        // that first so its background work actually stops; otherwise it
        // keeps pushing progress updates and competes with the next prompt
        // for the same provider connection.
        if (commandAbortRef.current) {
          commandAbortRef.current();
          commandAbortRef.current = null;
        }
        stream.abort();
        stream.setBusy(false);
        stream.setActive('');
        stream.setActiveTool(null);
        setCodemapProgress(null);
        return;
      }
      if (showShortcuts) {
        setShowShortcuts(false);
        return;
      }
      if (input) {
        setInput('');
        return;
      }
      exit();
    }
  });

  const handleInputKey = (ch: string, key: KeyMeta): boolean => {
    // `?` on an empty prompt toggles the shortcut list instead of typing.
    if (ch === '?' && input === '' && !key.ctrl && !key.meta) {
      setShowShortcuts((v) => !v);
      return true;
    }
    if (showShortcuts && !key.escape) setShowShortcuts(false);

    if (reconfigureMode || stream.busy || suggestions.length === 0) return false;
    if (key.upArrow) {
      setSuggestionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (key.downArrow) {
      setSuggestionIndex((i) => (i + 1) % suggestions.length);
      return true;
    }
    if (key.tab) {
      const choice = suggestions[suggestionIndex];
      if (choice) {
        setInput(choice.insert);
        setSuggestionIndex(0);
      }
      return true;
    }
    if (key.return) {
      const choice = suggestions[suggestionIndex];
      if (choice) {
        setInput(choice.insert);
        setSuggestionIndex(0);
        onSubmit(choice.insert);
        return true;
      }
    }
    return false;
  };

  const onSubmit = async (text: string) => {
    // While a turn runs the draft stays in the box; enter sends it afterwards.
    if (!text.trim() || stream.busy || reconfigureMode) return;
    const trimmed = text.trim();
    setInput('');
    setShowShortcuts(false);

    const handled = await runSlashCommand(
      {
        cwd,
        providerLabel,
        currentSession,
        setCurrentSession,
        setHistory: stream.setHistory,
        getHistory,
        appendLines: stream.appendLines,
        clearTranscript: stream.clearTranscript,
        setBusy: stream.setBusy,
        setCodemapProgress,
        registerAbort,
        enterReconfigure,
        exit,
      },
      trimmed,
    );
    if (handled) return;

    await stream.send(text);
  };

  const handleReconfigureComplete = async (config: NanoConfig) => {
    await saveConfig(config);
    clearConfigCache();
    resetProvider();
    setReconfigureMode(false);
    const newLabel = await describeProvider();
    setProviderKey((k) => k + 1);
    stream.appendLines({
      kind: 'notice',
      text: `configuration saved · now using ${newLabel}`,
    });
  };

  const handleReconfigureCancel = () => {
    setReconfigureMode(false);
    setExistingConfig(null);
  };

  const spinnerLabel = codemapProgress
    ? `Building codemap ${codemapProgress.done}/${codemapProgress.total}…`
    : thinkingPhrase;

  return (
    <ErrorBoundary>
      <Box flexDirection="column">
        <Transcript lines={stream.lines} />

        <Box flexDirection="column" maxHeight={Math.max(1, rows - 1)} overflow="hidden">
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {/* Live region — everything below repaints as the turn progresses. */}
        {stream.runningTools.map((t) => (
          <RunningToolCall
            key={t.id}
            name={t.name}
            args={t.args}
            startedAt={t.startedAt}
            waiting={Boolean(pending)}
          />
        ))}
        {stream.activeTool ? (
          <RunningToolCall name={stream.activeTool.name} args={safeParse(stream.activeTool.args)} />
        ) : null}

        {stream.active ? <StreamingMessage text={stream.active} columns={columns} rows={rows} /> : null}
        </Box>

        {stream.busy && !pending ? (
          <Spinner
            label={spinnerLabel}
            seconds={elapsed}
            tokens={codemapProgress ? 0 : turnTokens}
            detail={codemapProgress?.path ?? null}
            reasoning={stream.active ? '' : stream.reasoning}
          />
        ) : null}

        {pending ? (
          <ApprovalPrompt request={pending.req} selected={approvalIndex} />
        ) : reconfigureMode && existingConfig ? (
          <ReconfigurePrompt
            existingConfig={existingConfig}
            onComplete={handleReconfigureComplete}
            onCancel={handleReconfigureCancel}
          />
        ) : (
          <Box flexDirection="column" flexShrink={0}>
            <ModifiedFilesPanel tick={stream.tick} />
            <InputBox
              value={input}
              onChange={setInput}
              onSubmit={onSubmit}
              onKey={handleInputKey}
              placeholder={placeholder}
            />
            {!stream.busy && suggestions.length > 0 ? (
              <CommandSuggestions items={suggestions} selected={suggestionIndex} />
            ) : showShortcuts ? (
              <Shortcuts />
            ) : (
              <Footer
                inputEmpty={input === ''}
                context={stream.context}
                compactThreshold={compactThreshold}
                providerLabel={providerLabel}
              />
            )}
          </Box>
        )}
        </Box>
      </Box>
    </ErrorBoundary>
  );
}

/** Tool args stream in as partial JSON; render what parses, ignore the rest. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export { Banner };
