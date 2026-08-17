import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Banner } from '../../src/cli/components/Banner.js';
import { Transcript } from '../../src/cli/components/Transcript.js';
import { StatusBar } from '../../src/cli/components/StatusBar.js';
import { ApprovalPrompt, approvalHelpText } from '../../src/cli/components/ApprovalPrompt.js';
import { CommandSuggestions } from '../../src/cli/components/CommandSuggestions.js';
import { DiffPreview } from '../../src/cli/components/DiffPreview.js';
import type { Line } from '../../src/cli/types.js';

/** Strip ANSI so assertions run against plain text. */
function plain(s: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

describe('Banner', () => {
  it('shows the mark, version, provider and cwd', () => {
    const { lastFrame } = render(
      <Banner providerLabel="ollama · qwen3.6" cwd="/work/api" version="1.2.3" />,
    );
    const out = plain(lastFrame());
    expect(out).toContain('bonfire');
    expect(out).toContain('v1.2.3');
    expect(out).toContain('ollama · qwen3.6');
    expect(out).toContain('/work/api');
    expect(out).toContain('/help');
  });
});

describe('Transcript', () => {
  it('renders each line kind distinctly', () => {
    const lines: Line[] = [
      { kind: 'user', text: 'refactor the auth flow' },
      { kind: 'assistant', text: 'Done.' },
      { kind: 'tool', name: 'read_file', args: { path: 'src/a.ts' } },
      { kind: 'tool-result', name: 'read_file', result: { content: 'a\nb\nc' } },
      { kind: 'notice', text: 'context compacted' },
      { kind: 'error', text: 'connection refused' },
    ];
    const out = plain(render(<Transcript lines={lines} />).lastFrame());

    expect(out).toContain('refactor the auth flow');
    expect(out).toContain('Done.');
    // Tool calls read as prose, not JSON.
    expect(out).toContain('Read src/a.ts');
    expect(out).not.toContain('{"path"');
    expect(out).toContain('3 lines');
    expect(out).toContain('context compacted');
    expect(out).toContain('connection refused');
  });

  it('summarizes a shell result by exit code', () => {
    const out = plain(
      render(
        <Transcript
          lines={[
            { kind: 'tool', name: 'shell', args: { command: 'npm test' } },
            { kind: 'tool-result', name: 'shell', result: { exitCode: 1, stdout: '' } },
          ]}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('Run npm test');
    expect(out).toContain('exited 1');
  });

  it('reports a skipped tool call', () => {
    const out = plain(
      render(
        <Transcript
          lines={[{ kind: 'tool-result', name: 'write_file', result: { status: 'skipped' } }]}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('skipped by user');
  });
});

describe('StatusBar', () => {
  it('renders provider, tilde-shortened cwd and context meter', () => {
    const out = plain(
      render(
        <StatusBar
          providerLabel="ollama · qwen3.6"
          cwd="/Users/me/src/app"
          home="/Users/me"
          session={null}
          totals={{ input: 1200, output: 800, turns: 2 }}
          context={{ used: 4096, max: 8192, ratio: 0.5 }}
          changedCount={0}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('ollama · qwen3.6');
    expect(out).toContain('~/src/app');
    expect(out).toContain('50%');
    expect(out).toContain('2.0k tok');
  });

  it('shows the changed-file count when files were touched', () => {
    const out = plain(
      render(
        <StatusBar
          providerLabel="p"
          cwd="/w"
          home="/h"
          session={null}
          totals={{ input: 0, output: 0, turns: 0 }}
          context={null}
          changedCount={3}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('3 files changed');
  });
});

describe('ApprovalPrompt', () => {
  it('shows the command and cwd for a shell request', () => {
    const out = plain(
      render(
        <ApprovalPrompt request={{ tool: 'shell', command: 'rm -rf build', cwd: '/w' }} />,
      ).lastFrame(),
    );
    expect(out).toContain('Run shell command');
    expect(out).toContain('$ rm -rf build');
    expect(out).toContain('/w');
  });

  it('shows the URL for a fetch request', () => {
    const out = plain(
      render(
        <ApprovalPrompt request={{ tool: 'fetch', url: 'https://example.com/docs' }} />,
      ).lastFrame(),
    );
    expect(out).toContain('Fetch URL');
    expect(out).toContain('https://example.com/docs');
  });

  it('offers a scoped always option per tool kind', () => {
    expect(approvalHelpText({ tool: 'shell', command: 'ls', cwd: '/' })).toContain(
      'always for this command',
    );
    expect(
      approvalHelpText({ tool: 'edit_file', path: 'a.ts', diff: '' }),
    ).toContain('always for this file');
    expect(approvalHelpText({ tool: 'fetch', url: 'https://x.com' })).toContain(
      'always for this host',
    );
  });
});

describe('DiffPreview', () => {
  it('summarizes added and removed line counts', () => {
    const diff = ['@@ -1,2 +1,2 @@', '-const a = 1;', '+const a = 2;', ' const b = 3;'].join(
      '\n',
    );
    const out = plain(render(<DiffPreview diff={diff} />).lastFrame());
    expect(out).toContain('+1');
    expect(out).toContain('-1');
    expect(out).toContain('const a = 2;');
  });
});

describe('CommandSuggestions', () => {
  it('marks the selected entry and lists descriptions', () => {
    const items = [
      { trigger: '/compact', description: 'Reclaim context', insert: '/compact' },
      { trigger: '/context', description: 'Show usage', insert: '/context' },
    ];
    const out = plain(render(<CommandSuggestions items={items} selected={1} />).lastFrame());
    expect(out).toContain('/compact');
    expect(out).toContain('Show usage');
    expect(out).toContain('▸ /context');
  });

  it('renders nothing when there are no items', () => {
    expect(plain(render(<CommandSuggestions items={[]} selected={0} />).lastFrame())).toBe('');
  });
});
