import React from 'react';
import { render } from 'ink';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initMcp, shutdownMcp, describeProvider } from '../agent/index.js';
import { getConfigPath, loadConfig } from '../config.js';
import { setTheme } from './theme.js';
import { App } from './App.js';
import { Banner } from './components/Banner.js';

if (!process.stdin.isTTY) {
  const hint =
    process.platform === 'win32'
      ? 'On Git Bash / MSYS, run `winpty bonfire`, or use Windows Terminal or PowerShell directly.'
      : 'Run from a real terminal (not piped stdin).';
  console.error(`bonfire requires an interactive TTY.\n${hint}`);
  process.exit(1);
}

async function readVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli/bin.js → ../../package.json; src/cli/bin.tsx → ../../package.json
    const raw = await readFile(resolve(here, '..', '..', 'package.json'), 'utf-8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function configExists(): Promise<boolean> {
  try {
    await readFile(getConfigPath(), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

const mcpToolCount = await initMcp();
if (mcpToolCount > 0) {
  console.error(`[mcp] ${mcpToolCount} tool(s) available`);
}

const firstRun = !(await configExists());
const version = await readVersion();

// Apply the saved theme before the first paint, so the banner and the app
// agree on colours. An unknown name leaves the default in place.
const savedTheme = (await loadConfig().catch(() => null))?.ui?.theme;
if (savedTheme) setTheme(savedTheme);

// The banner is written once, above the interactive app, so it scrolls away
// with the rest of the history instead of being repainted every frame.
if (!firstRun) {
  const providerLabel = await describeProvider().catch(() => 'no provider');
  const banner = render(
    <Banner providerLabel={providerLabel} cwd={process.cwd()} version={version} />,
  );
  banner.unmount();
}

// Enable the Kitty keyboard protocol via `mode: 'enabled'` (a push, not a
// probe). Modern terminals (kitty, Ghostty, WezTerm, recent iTerm2) honour
// the set command and start sending CSI-u sequences for Shift+Enter; older
// terminals silently ignore the unknown CSI sequence. Crucially, there is no
// query — so nothing can leak as visible output the way `mode: 'auto'` does.
const app = render(<App firstRun={firstRun} version={version} />, {
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
  await shutdownMcp();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
app.waitUntilExit().then(cleanup);
