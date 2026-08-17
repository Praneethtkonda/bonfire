import { useEffect, useState } from 'react';

const ROTATE_MS = 5000;

const GENERIC = [
  'Thinking…',
  'Pondering…',
  'Cogitating…',
  'Consulting the spirits…',
  'Sharpening pencils…',
  'Rummaging through memory…',
  'Untangling the yak…',
  'Reading tea leaves…',
  'Doing the math…',
  'Searching for the right cliché…',
];

const PER_TOOL: Record<string, string[]> = {
  read_file: ['Skimming bytes…', 'Cracking open the file…', 'Reading between the lines…'],
  write_file: ['Drafting…', 'Scribbling…', 'Committing pixels to disk…'],
  edit_file: ['Performing surgery…', 'Rewriting reality…', 'Patching…'],
  navigate: ['Pacing the codemap…', 'Reading the map…', 'Wayfinding…'],
  search: ['Combing the haystack…', 'Grepping without grep…', 'Hunting for matches…'],
  list_dir: ['Rummaging through the drawer…', 'Taking inventory…', 'Listing entries…'],
  shell: ['Summoning the shell…', 'Consulting the daemon…', 'Running it…'],
  fetch_url: ['Dialling out…', 'Fetching…', 'Waiting on the wire…'],
  load_skill: ['Reading the manual…', 'Loading the playbook…'],
};

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

export function useThinkingPhrase(active: boolean, toolName?: string | null): string {
  const [phrase, setPhrase] = useState(() => pick(GENERIC));

  useEffect(() => {
    if (!active) return;
    const pool = (toolName && PER_TOOL[toolName]) || GENERIC;
    setPhrase(pick(pool));
    const id = setInterval(() => setPhrase(pick(pool)), ROTATE_MS);
    return () => clearInterval(id);
  }, [active, toolName]);

  return phrase;
}
