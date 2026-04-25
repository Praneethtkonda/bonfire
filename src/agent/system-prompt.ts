import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { getAllowedDirs } from '../tools/index.js';
import { loadConfig } from '../config.js';

const BASE_PROMPT = `You are bonfire, a terminal coding assistant.

You have tools to read, write, edit files, list directories, run shell commands, and navigate the repo through a hierarchical codemap in the user's working directory.

{{PLATFORM_HINT}}

Exploration strategy:
- Start every unfamiliar task with \`navigate(".")\` to see the repo's top-level layout with summaries.
- Drill down with \`navigate("<path>")\` — you will see direct children and their one-line summaries.
- Only call \`read_file\` on a file after navigate convinces you it's relevant. Do NOT grep blindly.
- Use \`list_dir\` only when you specifically need raw filesystem info (sizes, entries not tracked in the codemap).

Editing rules:
- When the user asks for a change, use tools to actually do it. Do not just describe.
- Before editing an existing file, read it first.
- Prefer edit_file over write_file for existing files.
- Keep replies short. The user can see tool output.
- After completing the task, confirm what you did in one sentence.`;

const PLATFORM_HINTS: Record<NodeJS.Platform | 'default', string> = {
  win32:
    'You are running on Windows. The `shell` tool invokes cmd.exe — use Windows-native commands (dir, type, findstr, copy, del, Remove-Item via powershell -Command). Do not use Unix utilities like ls/grep/cat/rm.',
  darwin:
    'You are running on macOS. The `shell` tool invokes /bin/sh — use standard POSIX commands.',
  default: `You are running on ${process.platform}. The \`shell\` tool invokes /bin/sh — use standard POSIX commands.`,
} as Record<NodeJS.Platform | 'default', string>;

function platformHint(): string {
  return PLATFORM_HINTS[process.platform] ?? PLATFORM_HINTS.default;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf-8')).trim();
  } catch {
    return null;
  }
}

/**
 * User overrides, in priority order (lowest → highest):
 *   1. Built-in BASE_PROMPT
 *   2. ~/.bonfire/system.md
 *   3. <cwd>/.bonfire/system.md
 *   4. config.systemPrompt (inline string in bonfire.config.json)
 *
 * Mode: 'append' (default) concatenates; 'replace' substitutes the base.
 */
async function gatherOverrides(cwd: string): Promise<string[]> {
  const cfg = await loadConfig();
  const overrides: string[] = [];
  const global = await readIfExists(resolve(homedir(), '.bonfire', 'system.md'));
  if (global) overrides.push(global);
  const project = await readIfExists(resolve(cwd, '.nano', 'system.md'));
  if (project) overrides.push(project);
  if (cfg.systemPrompt?.trim()) overrides.push(cfg.systemPrompt.trim());
  return overrides;
}

function dirsBlock(): string {
  const dirs = getAllowedDirs();
  if (dirs.length <= 1) return '';
  const extras = dirs.slice(1).map((d) => `- ${d}`).join('\n');
  return `\nAdditional allowed directories (pass absolute paths to tools):\n${extras}`;
}

export async function buildSystemPrompt(cwd: string = process.cwd()): Promise<string> {
  const cfg = await loadConfig();
  const mode = cfg.systemPromptMode ?? 'append';
  const base = BASE_PROMPT.replace('{{PLATFORM_HINT}}', platformHint());
  const overrides = await gatherOverrides(cwd);

  if (mode === 'replace' && overrides.length > 0) {
    return overrides.join('\n\n') + dirsBlock();
  }
  const sections = [base, ...overrides].filter(Boolean);
  return sections.join('\n\n') + dirsBlock();
}
