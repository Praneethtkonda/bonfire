import { tool } from 'ai';
import { headTail, toolOutputMaxChars } from './truncate.js';
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

/**
 * Room for stdout and stderr inside the window-relative tool output cap, so
 * the result isn't cut a second time. Both keep their tail, where build and
 * test errors are.
 */
export function shellOutputLimits(limit: number = toolOutputMaxChars()): {
  stdout: number;
  stderr: number;
} {
  const room = Math.max(1_000, limit - 200);
  const stderr = Math.floor(room / 4);
  return { stdout: room - stderr, stderr };
}

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

    const max = shellOutputLimits();
    try {
      const { stdout, stderr, exitCode } = await execa(command, {
        shell: true,
        cwd: getCwd(),
        timeout: policy.timeoutMs,
        reject: false,
      });
      return {
        exitCode,
        stdout: headTail(stdout, max.stdout),
        stderr: headTail(stderr, max.stderr),
      };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
});
