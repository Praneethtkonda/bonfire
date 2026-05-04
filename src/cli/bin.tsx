import React from 'react';
import { render } from 'ink';
import { readFile } from 'node:fs/promises';
import { initMcp, shutdownMcp } from '../agent/index.js';
import { getConfigPath } from '../config.js';
import { App } from './App.js';

if (!process.stdin.isTTY) {
  const hint =
    process.platform === 'win32'
      ? 'On Git Bash / MSYS, run `winpty bonfire`, or use Windows Terminal or PowerShell directly.'
      : 'Run from a real terminal (not piped stdin).';
  console.error(`bonfire requires an interactive TTY.\n${hint}`);
  process.exit(1);
}

const mcpToolCount = await initMcp();
if (mcpToolCount > 0) {
  console.error(`[mcp] ${mcpToolCount} tool(s) available`);
}

async function configExists(): Promise<boolean> {
  try {
    await readFile(getConfigPath(), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

const firstRun = !(await configExists());

// Enable the Kitty keyboard protocol via `mode: 'enabled'` (a push, not a
// probe). Modern terminals (kitty, Ghostty, WezTerm, recent iTerm2) honour
// the set command and start sending CSI-u sequences for Shift+Enter; older
// terminals silently ignore the unknown CSI sequence. Crucially, there is no
// query — so nothing can leak as visible output the way `mode: 'auto'` does.
const app = render(<App firstRun={firstRun} />, {
  kittyKeyboard: { mode: 'enabled', flags: ['disambiguateEscapeCodes'] },
});

// Enable bracketed paste mode so the terminal wraps pasted text in markers
// (Ink's input parser already understands them). Without this, a pasted block
// containing newlines is delivered as a stream of keypresses and the embedded
// \r submits the prompt mid-paste.
process.stdout.write('\x1b[?2004h');

const cleanup = async () => {
  process.stdout.write('\x1b[?2004l');
  app.unmount();
  process.stdout.write('\x1b[2J\x1b[0f');
  await shutdownMcp();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
app.waitUntilExit().then(cleanup);
