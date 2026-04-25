const IS_WINDOWS = process.platform === 'win32';

/**
 * On Windows, Node's child_process.spawn won't resolve .cmd shims (like npx, uvx,
 * pnpm) unless the extension is explicit or shell:true is used. Normalize to
 * <command>.cmd when the command has no extension and isn't an absolute path.
 */
export function resolveWindowsCommand(command: string): string {
  if (!IS_WINDOWS) return command;
  if (/[\\/]/.test(command)) return command;
  if (/\.(cmd|exe|bat|com|ps1)$/i.test(command)) return command;
  return `${command}.cmd`;
}
