import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getShellPolicy,
  isShellDenied,
  isShellPreApproved,
  rememberShellApproval,
  resetShellPolicyCache,
} from '../../src/tools/shell-policy.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: async () => mockedConfig,
}));

let mockedConfig: any = {};

beforeEach(() => {
  resetShellPolicyCache();
  mockedConfig = {};
});

afterEach(() => {
  resetShellPolicyCache();
});

async function policyWith(security: any) {
  mockedConfig = { security };
  resetShellPolicyCache();
  return getShellPolicy();
}

describe('hardcoded deny patterns', () => {
  // Each entry: [label, command, shouldBeDenied]
  const denyCases: [string, string][] = [
    ['rm -rf /',           'rm -rf /'],
    ['rm -Rf /',           'rm -Rf /'],
    ['rm -rf / followed by anything', 'rm -rf / && echo done'],
    ['rm -rf ~',           'rm -rf ~'],
    ['rm -rf ~/',          'rm -rf ~/'],
    ['rm -rf /*',          'rm -rf /*'],
    ['fork bomb',          ':(){ :|:& };:'],
    ['mkfs.ext4',          'mkfs.ext4 /dev/sda1'],
    ['plain mkfs',         'mkfs /dev/sda'],
    ['dd of=/dev/sda',     'dd if=/dev/zero of=/dev/sda bs=1M'],
    ['shutdown',           'shutdown -h now'],
    ['halt',               'halt'],
    ['reboot',             'reboot'],
    ['poweroff',           'poweroff'],
    ['init 0',             'init 0'],
    ['init 6',             'init 6'],
    ['chmod -R 777 /',     'chmod -R 777 /'],
    ['chown -R user /',    'chown -R user /'],
  ];

  it.each(denyCases)('rejects: %s', async (_label, cmd) => {
    const policy = await policyWith({ shell: { requireApproval: true } });
    expect(isShellDenied(cmd, policy)).toBe(true);
  });

  const allowCases: [string, string][] = [
    ['rm of a file',           'rm foo.txt'],
    ['rm in subdirectory',     'rm -rf node_modules'],
    ['ls',                     'ls -la'],
    ['git status',             'git status'],
    ['shutdown as substring',  'echo shutdownish'],
  ];

  it.each(allowCases)('does not reject: %s', async (_label, cmd) => {
    const policy = await policyWith({ shell: { requireApproval: true } });
    expect(isShellDenied(cmd, policy)).toBe(false);
  });
});

describe('user deny patterns', () => {
  it('compiles and applies user-supplied deny regexes alongside the hard list', async () => {
    const policy = await policyWith({
      shell: { deniedCommands: ['^curl\\s'] },
    });
    expect(isShellDenied('curl https://example.com', policy)).toBe(true);
    expect(isShellDenied('rm -rf /', policy)).toBe(true);
    expect(isShellDenied('echo hi', policy)).toBe(false);
  });

  it('ignores invalid regex patterns rather than crashing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const policy = await policyWith({
      shell: { deniedCommands: ['(unbalanced'] },
    });
    expect(isShellDenied('echo hi', policy)).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('pre-approval', () => {
  it('treats commands matching allowedCommands as pre-approved', async () => {
    const policy = await policyWith({
      shell: { allowedCommands: ['^git status$', '^npm test$'] },
    });
    expect(isShellPreApproved('git status', policy)).toBe(true);
    expect(isShellPreApproved('npm test', policy)).toBe(true);
    expect(isShellPreApproved('git push', policy)).toBe(false);
  });

  it('remembers session-level "always" approvals', async () => {
    const policy = await policyWith({ shell: {} });
    expect(isShellPreApproved('ls', policy)).toBe(false);
    rememberShellApproval('ls');
    expect(isShellPreApproved('ls', policy)).toBe(true);
  });
});

describe('timeout', () => {
  it('defaults to 60s', async () => {
    const policy = await policyWith({ shell: {} });
    expect(policy.timeoutMs).toBe(60_000);
  });

  it('respects user-configured timeoutMs', async () => {
    const policy = await policyWith({ shell: { timeoutMs: 5_000 } });
    expect(policy.timeoutMs).toBe(5_000);
  });

  it('falls back to default for non-positive values', async () => {
    const policy = await policyWith({ shell: { timeoutMs: 0 } });
    expect(policy.timeoutMs).toBe(60_000);
  });
});

describe('requireApproval', () => {
  it('defaults to true', async () => {
    const policy = await policyWith({ shell: {} });
    expect(policy.requireApproval).toBe(true);
  });

  it('respects explicit false', async () => {
    const policy = await policyWith({ shell: { requireApproval: false } });
    expect(policy.requireApproval).toBe(false);
  });
});
