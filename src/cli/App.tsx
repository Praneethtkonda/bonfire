import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { homedir } from 'node:os';
import type { Session } from '../session/index.js';
import { resetProvider, describeProvider } from '../agent/index.js';
import { changedFiles } from '../tools/index.js';
import type { CodemapProgress } from './types.js';
import { runSlashCommand, suggestCommands } from './commands/index.js';
import { useApproval } from './hooks/useApproval.js';
import { useProvider } from './hooks/useProvider.js';
import { useAgentStream } from './hooks/useAgentStream.js';
import { useThinkingPhrase } from './hooks/useThinkingPhrase.js';
import { useElapsed } from './hooks/useElapsed.js';
import { useThemeVersion } from './hooks/useTheme.js';
import { Banner } from './components/Banner.js';
import { Transcript } from './components/Transcript.js';
import { ModifiedFilesPanel } from './components/ModifiedFilesPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { ApprovalPrompt, approvalHelpText } from './components/ApprovalPrompt.js';
import { PromptBar } from './components/PromptBar.js';
import { CommandSuggestions } from './components/CommandSuggestions.js';
import { ReconfigurePrompt } from './components/ReconfigurePrompt.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { describeCall } from './components/ToolLine.js';
import type { KeyMeta } from './components/MultilineInput.js';
import { truncate } from './util.js';
import { theme } from './theme.js';
import {
  loadConfig,
  saveConfig,
  clearConfigCache,
  DEFAULT_CONFIG,
  type NanoConfig,
} from '../config.js';

export interface AppProps {
  /** When true, the app opens the reconfigure prompt on first paint (used for first-run onboarding). */
  firstRun?: boolean;
  version?: string;
}

export function App({ firstRun = false, version = '0.0.0' }: AppProps) {
  const { exit } = useApp();
  const cwd = process.cwd();
  const home = homedir();
  const { pending, decide } = useApproval();

  const [input, setInput] = useState('');
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [codemapProgress, setCodemapProgress] = useState<CodemapProgress | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [reconfigureMode, setReconfigureMode] = useState(false);
  const [existingConfig, setExistingConfig] = useState<NanoConfig | null>(null);
  const [providerKey, setProviderKey] = useState(0);

  const providerLabel = useProvider(providerKey);

  const stream = useAgentStream({ cwd, providerLabel, currentSession, setCurrentSession });
  const thinkingPhrase = useThinkingPhrase(stream.busy, stream.activeTool?.name ?? null);
  const elapsed = useElapsed(stream.busy);
  useThemeVersion();

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

  // Approval and global escape live above the input — they fire even while the
  // multiline input is disabled.
  useInput((ch, key) => {
    if (pending) {
      if (ch === 'y' || ch === 'Y' || key.return) decide('yes');
      else if (ch === 'a' || ch === 'A') decide('always');
      else if (ch === 'n' || ch === 'N' || key.escape) decide('no');
      return;
    }
    // Esc precedence: abort while busy → clear pending input → exit when idle.
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
      if (input) {
        setInput('');
        return;
      }
      exit();
    }
  });

  const handleInputKey = (_ch: string, key: KeyMeta): boolean => {
    if (reconfigureMode || suggestions.length === 0) return false;
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
    if (!text.trim() || stream.busy || reconfigureMode) return;
    const trimmed = text.trim();
    setInput('');

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

  const activeToolLabel = stream.activeTool
    ? describeCall(stream.activeTool.name, safeParse(stream.activeTool.args))
    : null;

  return (
    <ErrorBoundary>
      <Box flexDirection="column">
        <Transcript lines={stream.lines} />

        {/* Live region — everything below repaints as the turn progresses. */}
        {stream.active ? (
          <Box marginTop={1}>
            <Text color={theme.body}>{stream.active}</Text>
          </Box>
        ) : null}

        {!stream.active && stream.reasoning ? (
          <Box marginTop={1}>
            <Text color={theme.muted} dimColor>
              {truncate(stream.reasoning.replace(/\s+/g, ' '), 160)}
            </Text>
          </Box>
        ) : null}

        <ModifiedFilesPanel tick={stream.tick} />

        {pending ? <ApprovalPrompt request={pending.req} /> : null}

        {reconfigureMode && existingConfig ? (
          <ReconfigurePrompt
            existingConfig={existingConfig}
            onComplete={handleReconfigureComplete}
            onCancel={handleReconfigureCancel}
          />
        ) : null}

        <Box flexDirection="column" marginTop={1}>
          {!reconfigureMode && !pending && !stream.busy && suggestions.length > 0 ? (
            <CommandSuggestions items={suggestions} selected={suggestionIndex} />
          ) : null}

          <PromptBar
            approvalHelp={pending ? approvalHelpText(pending.req) : null}
            busy={stream.busy}
            codemapProgress={codemapProgress}
            thinkingPhrase={thinkingPhrase}
            elapsedSeconds={elapsed}
            activeToolLabel={activeToolLabel}
            input={input}
            onChange={setInput}
            onSubmit={onSubmit}
            onKey={handleInputKey}
            hidden={reconfigureMode}
          />

          {!reconfigureMode ? (
            <StatusBar
              providerLabel={providerLabel}
              cwd={cwd}
              home={home}
              session={currentSession}
              totals={stream.totals}
              context={stream.context}
              changedCount={changedFiles.size}
            />
          ) : null}
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
