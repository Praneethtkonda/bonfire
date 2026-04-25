import { loadConfig } from '../config.js';

/**
 * Hardcoded refusal patterns. These commands cannot be approved — they're
 * either irreversible (rm -rf /), system-bricking (mkfs, dd of=/dev/sda),
 * or fork bombs / shutdown commands.
 */
const HARD_DENY: RegExp[] = [
  /\brm\s+-[rRfF]+\s+\/(\s|$)/,            // rm -rf /
  /\brm\s+-[rRfF]+\s+~\/?(\s|$)/,          // rm -rf ~
  /\brm\s+-[rRfF]+\s+\/[*\s]/,             // rm -rf /*
  /:\(\)\s*\{[^}]*:\|:[^}]*\};:/,          // fork bomb
  /\bmkfs(\.[a-z0-9]+)?\b/,                // mkfs.ext4 ...
  /\bdd\s+[^|]*\bof=\/dev\//,              // dd of=/dev/sda
  /\b(shutdown|halt|reboot|poweroff|init\s+0|init\s+6)\b/,
  /\b(chmod|chown)\s+-R\s+[^/]*\s+\/(\s|$)/, // chmod -R 777 /
];

export interface ShellPolicy {
  allowedPatterns: RegExp[];
  deniedPatterns: RegExp[];
  requireApproval: boolean;
}

let cached: ShellPolicy | null = null;

function compile(patterns: string[] | undefined): RegExp[] {
  if (!patterns) return [];
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[security] ignoring invalid shell pattern /${p}/ — ${msg}`);
    }
  }
  return out;
}

export async function getShellPolicy(): Promise<ShellPolicy> {
  if (cached) return cached;
  const cfg = await loadConfig();
  const sh = cfg.security?.shell ?? {};
  cached = {
    allowedPatterns: compile(sh.allowedCommands),
    deniedPatterns: [...HARD_DENY, ...compile(sh.deniedCommands)],
    requireApproval: sh.requireApproval ?? true,
  };
  return cached;
}

/** In-session pre-approvals — the user picked "always" for this exact command. */
const sessionAllow = new Set<string>();

export function rememberShellApproval(command: string) {
  sessionAllow.add(command.trim());
}

export function isShellPreApproved(command: string, policy: ShellPolicy): boolean {
  const c = command.trim();
  if (sessionAllow.has(c)) return true;
  return policy.allowedPatterns.some((re) => re.test(c));
}

export function isShellDenied(command: string, policy: ShellPolicy): boolean {
  return policy.deniedPatterns.some((re) => re.test(command));
}
