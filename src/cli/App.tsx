import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Session } from '../session/index.js';
import { listTools, type ToolDescriptor } from '../agent/index.js';
import type { CodemapProgress } from './types.js';
import { runSlashCommand, suggestCommands } from './commands/index.js';
import { useApproval } from './hooks/useApproval.js';
import { useProvider } from './hooks/useProvider.js';
import { useAgentStream } from './hooks/useAgentStream.js';
import { useThinkingPhrase } from './hooks/useThinkingPhrase.js';
import { Header } from './components/Header.js';
import { Transcript } from './components/Transcript.js';
import { ModifiedFilesPanel } from './components/ModifiedFilesPanel.js';
import { UsageBar } from './components/UsageBar.js';
import { ApprovalPrompt, approvalHelpText } from './components/ApprovalPrompt.js';
import { PromptBar } from './components/PromptBar.js';
import { ToolsPane } from './components/ToolsPane.js';
import { CommandSuggestions } from './components/CommandSuggestions.js';
import type { KeyMeta } from './components/MultilineInput.js';
import { truncate } from './util.js';

export function App() {
  const { exit } = useApp();
  const cwd = process.cwd();
  const providerLabel = useProvider();
  const { pending, decide } = useApproval();

  const [input, setInput] = useState('');
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [codemapProgress, setCodemapProgress] = useState<CodemapProgress | null>(null);
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  const stream = useAgentStream({ cwd, currentSession, setCurrentSession });
  const thinkingPhrase = useThinkingPhrase(stream.busy, stream.activeTool?.name ?? null);

  useEffect(() => {
    setTools(listTools());
  }, []);

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
    if (key.escape && !input) exit();
  });

  const handleInputKey = (_ch: string, key: KeyMeta): boolean => {
    if (suggestions.length === 0) return false;
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
      if (choice) setInput(choice.insert);
      return true;
    }
    return false;
  };

  const onSubmit = async (text: string) => {
    if (!text.trim() || stream.busy) return;
    const trimmed = text.trim();
    setInput('');

    const handled = await runSlashCommand(
      {
        cwd,
        providerLabel,
        currentSession,
        setCurrentSession,
        setHistory: stream.setHistory,
        appendLines: stream.appendLines,
        setBusy: stream.setBusy,
        setCodemapProgress,
        exit,
      },
      trimmed,
    );
    if (handled) return;

    await stream.send(text);
  };

  return (
    <Box flexDirection="column">
      <Header providerLabel={providerLabel} cwd={cwd} session={currentSession} />

      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          <Transcript lines={stream.lines} />

          {stream.active ? <Text color="white">{stream.active}</Text> : null}

          {stream.activeTool ? (
            <Text color="cyan" dimColor>
              {'  '}● {stream.activeTool.name}({truncate(stream.activeTool.args, 120)})
            </Text>
          ) : null}

          <ModifiedFilesPanel tick={stream.tick} />

          <UsageBar totals={stream.totals} last={stream.lastUsage} />

          {pending ? <ApprovalPrompt request={pending.req} /> : null}

          {!pending && !stream.busy && suggestions.length > 0 ? (
            <CommandSuggestions items={suggestions} selected={suggestionIndex} />
          ) : null}

          <Box marginTop={1}>
            <PromptBar
              approvalHelp={pending ? approvalHelpText(pending.req) : null}
              busy={stream.busy}
              codemapProgress={codemapProgress}
              thinkingPhrase={thinkingPhrase}
              input={input}
              onChange={setInput}
              onSubmit={onSubmit}
              onKey={handleInputKey}
            />
          </Box>
        </Box>

        <ToolsPane tools={tools} activeTool={stream.activeTool?.name ?? null} />
      </Box>
    </Box>
  );
}
