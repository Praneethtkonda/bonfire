import { useEffect, useState } from 'react';

const ROTATE_MS = 4000;

/** One-word gerunds, in the register of Claude Code's working indicator. */
export const THINKING_VERBS = [
  'Thinking',
  'Pondering',
  'Crafting',
  'Considering',
  'Reasoning',
  'Mulling',
  'Working',
  'Puzzling',
  'Weighing',
  'Untangling',
  'Assembling',
  'Tinkering',
  'Composing',
  'Synthesizing',
  'Deliberating',
  'Brewing',
];

/** Verbs that describe what a running tool is actually doing. */
const PER_TOOL: Record<string, string[]> = {
  read_file: ['Reading', 'Skimming'],
  write_file: ['Writing', 'Drafting'],
  edit_file: ['Editing', 'Patching'],
  navigate: ['Exploring', 'Wayfinding'],
  search: ['Searching', 'Combing'],
  list_dir: ['Listing', 'Browsing'],
  shell: ['Running', 'Executing'],
  fetch_url: ['Fetching', 'Downloading'],
  load_skill: ['Loading'],
  memory: ['Remembering', 'Recalling'],
};

function pick(list: string[], avoid?: string): string {
  if (list.length === 1) return list[0];
  let next = list[Math.floor(Math.random() * list.length)];
  while (next === avoid) next = list[Math.floor(Math.random() * list.length)];
  return next;
}

/** A rotating "Pondering…" style verb while the model works. */
export function useThinkingPhrase(active: boolean, toolName?: string | null): string {
  const [verb, setVerb] = useState(() => pick(THINKING_VERBS));

  useEffect(() => {
    if (!active) return;
    const pool = (toolName && PER_TOOL[toolName]) || THINKING_VERBS;
    setVerb((v) => pick(pool, v));
    const id = setInterval(() => setVerb((v) => pick(pool, v)), ROTATE_MS);
    return () => clearInterval(id);
  }, [active, toolName]);

  return `${verb}…`;
}
