import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateTool } from '../../src/mcp/index.js';
import { setApprovalHandler, type ApprovalDecision } from '../../src/tools/approval.js';

interface ToolWithExecute {
  description?: string;
  execute?: (args: unknown, ctx?: unknown) => Promise<unknown>;
}

beforeEach(() => {
  setApprovalHandler(null);
});

afterEach(() => {
  setApprovalHandler(null);
});

describe('gateTool', () => {
  it('returns the tool unchanged when execute is missing', () => {
    const tool = { description: 'noop' };
    expect(gateTool('foo', tool)).toBe(tool);
  });

  it('returns the tool unchanged when given null/undefined', () => {
    expect(gateTool('foo', null)).toBeNull();
    expect(gateTool('foo', undefined)).toBeUndefined();
  });

  it('calls the original execute when approval = yes', async () => {
    setApprovalHandler(async () => 'yes' as ApprovalDecision);
    let invokedWith: unknown;
    const tool: ToolWithExecute = {
      execute: async (args) => {
        invokedWith = args;
        return { ok: true };
      },
    };
    const gated = gateTool('listFiles', tool) as ToolWithExecute;
    const result = await gated.execute!({ path: '.' });
    expect(invokedWith).toEqual({ path: '.' });
    expect(result).toEqual({ ok: true });
  });

  it('returns a denied result when approval = no, without invoking original', async () => {
    setApprovalHandler(async () => 'no' as ApprovalDecision);
    let called = false;
    const tool: ToolWithExecute = {
      execute: async () => {
        called = true;
        return 'should-not-run';
      },
    };
    const gated = gateTool('listFiles', tool) as ToolWithExecute;
    const result = await gated.execute!({});
    expect(called).toBe(false);
    expect(result).toEqual({ status: 'skipped', reason: 'denied by user' });
  });

  it('passes the qualified name and args to the approval handler', async () => {
    type SeenReq = { tool: string; name?: string; args?: unknown };
    const seen: SeenReq[] = [];
    setApprovalHandler(async (req) => {
      seen.push(req as SeenReq);
      return 'yes';
    });
    const tool: ToolWithExecute = { execute: async () => 'ok' };
    const gated = gateTool('myserver__doThing', tool) as ToolWithExecute;
    await gated.execute!({ key: 'value' });
    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe('mcp');
    expect(seen[0].name).toBe('myserver__doThing');
    expect(seen[0].args).toEqual({ key: 'value' });
  });

  it('forwards the ctx parameter unchanged on approval', async () => {
    setApprovalHandler(async () => 'yes');
    let receivedCtx: unknown;
    const tool: ToolWithExecute = {
      execute: async (_args, ctx) => {
        receivedCtx = ctx;
        return null;
      },
    };
    const gated = gateTool('x', tool) as ToolWithExecute;
    await gated.execute!({}, { signal: 'abc' });
    expect(receivedCtx).toEqual({ signal: 'abc' });
  });

  it('preserves other properties on the wrapped tool object', () => {
    const tool: ToolWithExecute = {
      description: 'list files',
      execute: async () => null,
    };
    const gated = gateTool('x', tool) as ToolWithExecute;
    expect(gated.description).toBe('list files');
  });
});
