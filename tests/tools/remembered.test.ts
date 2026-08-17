import { beforeEach, describe, expect, it } from 'vitest';
import {
  isApprovalRemembered,
  rememberApproval,
  rememberedCount,
  resetRememberedApprovals,
} from '../../src/tools/remembered.js';

describe('remembered approvals', () => {
  beforeEach(() => {
    resetRememberedApprovals();
  });

  it('starts empty', () => {
    expect(rememberedCount()).toBe(0);
    expect(isApprovalRemembered('file', 'src/a.ts')).toBe(false);
  });

  it('remembers a key within its scope', () => {
    rememberApproval('file', 'src/a.ts');
    expect(isApprovalRemembered('file', 'src/a.ts')).toBe(true);
    expect(rememberedCount()).toBe(1);
  });

  it('keeps scopes isolated', () => {
    rememberApproval('shell', 'npm');
    expect(isApprovalRemembered('shell', 'npm')).toBe(true);
    expect(isApprovalRemembered('file', 'npm')).toBe(false);
    expect(isApprovalRemembered('mcp', 'npm')).toBe(false);
    expect(isApprovalRemembered('fetch', 'npm')).toBe(false);
  });

  it('is idempotent for the same key', () => {
    rememberApproval('mcp', 'server:tool');
    rememberApproval('mcp', 'server:tool');
    expect(rememberedCount()).toBe(1);
  });

  it('counts keys across scopes', () => {
    rememberApproval('shell', 'git');
    rememberApproval('file', 'src/a.ts');
    rememberApproval('fetch', 'example.com');
    expect(rememberedCount()).toBe(3);
  });

  it('clears everything on reset', () => {
    rememberApproval('shell', 'git');
    rememberApproval('file', 'src/a.ts');
    resetRememberedApprovals();
    expect(rememberedCount()).toBe(0);
    expect(isApprovalRemembered('shell', 'git')).toBe(false);
  });
});
