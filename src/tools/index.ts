import { editFileTool, listDirTool, readFileTool, writeFileTool } from './file-tools.js';
import { shellTool } from './shell-tool.js';
import { navigateTool } from './navigate-tool.js';
import { fetchUrlTool } from './fetch-tool.js';
import { loadSkillTool } from '../skills/index.js';

export type { ApprovalRequest, ApprovalDecision, ApprovalHandler } from './approval.js';
export { setApprovalHandler } from './approval.js';
export { changedFiles } from './changed-files.js';
export type { FileChange } from './changed-files.js';
export { addAllowedDir, getAllowedDirs } from './safe-path.js';

export const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  navigate: navigateTool,
  list_dir: listDirTool,
  shell: shellTool,
  fetch_url: fetchUrlTool,
  load_skill: loadSkillTool,
};

export interface ToolDescriptor {
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
}

const BUILTIN_DESCRIPTIONS: Record<keyof typeof tools, string> = {
  read_file: 'Read a file from an allowed directory',
  write_file: 'Create / overwrite a file (diff approval gated)',
  edit_file: 'Replace an exact string in a file (diff approval gated)',
  navigate: 'Walk the codemap with one-line summaries',
  list_dir: 'List directory entries (raw, no summaries)',
  shell: 'Run a shell command (approval gated, deny-list applied)',
  fetch_url: 'Fetch an http(s) URL and return the response body (HTML stripped to text)',
  load_skill: 'Load detailed instructions for a named skill',
};

export function describeBuiltins(): ToolDescriptor[] {
  return Object.entries(BUILTIN_DESCRIPTIONS).map(([name, description]) => ({
    name,
    description,
    source: 'builtin' as const,
  }));
}
