import React from 'react';
import { render } from 'ink';
import { initMcp, shutdownMcp } from '../agent/index.js';
import { App } from './App.js';
import { checkAndRunOnboarding } from './onboarding.js';

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

const shouldExit = await checkAndRunOnboarding();
if (shouldExit) {
  await shutdownMcp();
  process.exit(0);
}

const app = render(<App />);

const cleanup = async () => {
  await shutdownMcp();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
app.waitUntilExit().then(cleanup);
