import { useEffect, useState } from 'react';

const ROTATE_MS = 2400;

const GENERIC = [
  'thinking…',
  'pondering…',
  'cogitating…',
  'consulting the spirits…',
  'sharpening pencils…',
  'rummaging through memory…',
  'untangling the yak…',
  'reading tea leaves…',
  'doing the math…',
  'searching for the right cliché…',
];

const PER_TOOL: Record<string, string[]> = {
  read_file: ['skimming bytes…', 'cracking open the file…', 'reading between the lines…'],
  write_file: ['drafting…', 'scribbling…', 'committing pixels to disk…'],
  edit_file: ['surgical edit in progress…', 'rewriting reality…', 'patching…'],
  navigate: ['pacing the codemap…', 'reading the map…', 'wayfinding…'],
  list_dir: ['rummaging through the drawer…', 'taking inventory…', 'listing entries…'],
  shell: ['summoning the shell…', 'ssh-ing into the machine…', 'consulting the daemon…'],
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
