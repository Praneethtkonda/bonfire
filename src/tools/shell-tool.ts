import { tool } from 'ai';
import { z } from 'zod';
import { execa } from 'execa';
import { requestApproval } from './approval.js';
import { getCwd } from './safe-path.js';
import {
  getShellPolicy,
  isShellDenied,
  isShellPreApproved,
  rememberShellApproval,
} from './shell-policy.js';

export const shellTool = tool({
  description:
    'Run a shell command in the working directory. Uses /bin/sh on Unix and cmd.exe on Windows. Use for git, tests, builds, searches.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
  }),
  execute: async ({ command }) => {
    const policy = await getShellPolicy();

    if (isShellDenied(command, policy)) {
      return {
        error: `command refused by deny-list: ${command}`,
        status: 'denied',
      };
    }

    if (policy.requireApproval && !isShellPreApproved(command, policy)) {
      const decision = await requestApproval({
        tool: 'shell',
        command,
        cwd: getCwd(),
      });
      if (decision === 'no') {
        return { command, status: 'skipped' };
      }
      if (decision === 'always') {
        rememberShellApproval(command);
      }
    }

    try {
      const { stdout, stderr, exitCode } = await execa(command, {
        shell: true,
        cwd: getCwd(),
        timeout: 60_000,
        reject: false,
      });
      return {
        exitCode,
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 2000),
      };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});
