import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Banner } from '../../src/cli/components/Banner.js';
import { Transcript } from '../../src/cli/components/Transcript.js';
import { ApprovalPrompt, approvalOptions } from '../../src/cli/components/ApprovalPrompt.js';
import { CommandSuggestions } from '../../src/cli/components/CommandSuggestions.js';
import {
  DiffPreview,
  describeDiffStats,
  diffStats,
} from '../../src/cli/components/DiffPreview.js';
import { Footer, contextHint } from '../../src/cli/components/Footer.js';
import { LOGO_LINES, gradientHex, logoColorEnabled } from '../../src/cli/components/Logo.js';
import { parseBlocks, stripInline } from '../../src/cli/markdown.js';
import type { Line } from '../../src/cli/types.js';

/** Strip ANSI so assertions run against plain text. */
function plain(s: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

const DIFF = ['@@ -10,2 +10,2 @@', '-const a = 1;', '+const a = 2;', ' const b = 3;'].join('\n');

describe('Banner', () => {
  it('shows the logo, welcome box, version, model and cwd', () => {
    const out = plain(
      render(
        <Banner
          providerLabel="ollama · qwen3.6"
          cwd="/work/api"
          version="1.2.3"
          color={false}
          columns={100}
        />,
      ).lastFrame(),
    );
    expect(out).toContain(LOGO_LINES[0].trimEnd());
    expect(out).toContain('Welcome to bonfire!');
    expect(out).toContain('v1.2.3');
    expect(out).toContain('ollama · qwen3.6');
    expect(out).toContain('/work/api');
    expect(out).toContain('/help');
    expect(out).toContain('Tips for getting started');
  });

  it('falls back to a one-line mark on narrow terminals', () => {
    const out = plain(
      render(
        <Banner providerLabel="p" cwd="/w" version="1" color={false} columns={30} />,
      ).lastFrame(),
    );
    expect(out).toContain('◆ Bonfire');
    expect(out).not.toContain('███');
  });
});

describe('Logo', () => {
  it('runs the fire gradient from red-orange to amber', () => {
    const width = LOGO_LINES[0].length;
    expect(gradientHex(0, width)).toBe('#ff4d00');
    expect(gradientHex(width - 1, width)).toBe('#ffb300');
  });

  it('turns colour off for NO_COLOR and non-TTY output', () => {
    expect(logoColorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(logoColorEnabled({}, false)).toBe(false);
    expect(logoColorEnabled({}, true)).toBe(true);
  });
});

describe('Transcript', () => {
  it('renders messages, tool calls and notices Claude Code style', () => {
    const lines: Line[] = [
      { kind: 'user', text: 'refactor the auth flow' },
      { kind: 'assistant', text: 'Done with **bold** text.' },
      {
        kind: 'tool',
        name: 'read_file',
        args: { path: 'src/a.ts' },
        result: { content: 'a\nb\nc' },
      },
      { kind: 'notice', text: 'context compacted' },
      { kind: 'error', text: 'connection refused' },
      { kind: 'interrupted' },
      { kind: 'turn-summary', seconds: 74, outputTokens: 1200 },
    ];
    const out = plain(render(<Transcript lines={lines} />).lastFrame());

    expect(out).toContain('> refactor the auth flow');
    expect(out).toContain('⏺ Done with bold text.');
    expect(out).toContain('Read(src/a.ts)');
    expect(out).not.toContain('{"path"');
    expect(out).toContain('⎿  Read 3 lines');
    expect(out).toContain('context compacted');
    expect(out).toContain('connection refused');
    expect(out).toContain('Interrupted');
    expect(out).toContain('Worked for 1m 14s');
  });

  it('summarizes a shell result by exit code with an output preview', () => {
    const out = plain(
      render(
        <Transcript
          lines={[
            {
              kind: 'tool',
              name: 'shell',
              args: { command: 'npm test' },
              result: { exitCode: 1, stdout: 'one\ntwo\nthree\nfour\nFAIL x' },
            },
          ]}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('Bash(npm test)');
    expect(out).toContain('Exit 1');
    expect(out).toContain('FAIL x');
  });

  it('reports a declined tool call', () => {
    const out = plain(
      render(
        <Transcript
          lines={[{ kind: 'tool-result', name: 'write_file', result: { status: 'skipped' } }]}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('Declined by user');
  });

  it('shows the approved diff under an edit', () => {
    const out = plain(
      render(
        <Transcript
          lines={[
            {
              kind: 'tool',
              name: 'edit_file',
              args: { path: 'src/a.ts' },
              result: { path: 'src/a.ts', status: 'edited' },
              diff: DIFF,
            },
          ]}
        />,
      ).lastFrame(),
    );
    expect(out).toContain('Update(src/a.ts)');
    expect(out).toContain('Updated src/a.ts with 1 addition and 1 removal');
    expect(out).toContain('10 -');
    expect(out).toContain('10 +');
  });
});

describe('ApprovalPrompt', () => {
  it('shows the command, cwd and numbered options for a shell request', () => {
    const out = plain(
      render(
        <ApprovalPrompt request={{ tool: 'shell', command: 'rm -rf build', cwd: '/w' }} />,
      ).lastFrame(),
    );
    expect(out).toContain('Bash command');
    expect(out).toContain('rm -rf build');
    expect(out).toContain('/w');
    expect(out).toContain('Do you want to proceed?');
    expect(out).toContain('❯ 1. Yes');
    expect(out).toContain('3. No');
  });

  it('shows the file and diff for an edit request', () => {
    const out = plain(
      render(
        <ApprovalPrompt request={{ tool: 'edit_file', path: 'src/a.ts', diff: DIFF }} />,
      ).lastFrame(),
    );
    expect(out).toContain('Edit file');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('const a = 2;');
  });

  it('shows the URL for a fetch request', () => {
    const out = plain(
      render(
        <ApprovalPrompt request={{ tool: 'fetch', url: 'https://example.com/docs' }} />,
      ).lastFrame(),
    );
    expect(out).toContain('https://example.com/docs');
  });

  it('offers a scoped always option per tool kind', () => {
    const labels = (r: Parameters<typeof approvalOptions>[0]) =>
      approvalOptions(r).map((o) => o.label).join('\n');
    expect(labels({ tool: 'shell', command: 'ls', cwd: '/' })).toContain('this command');
    expect(labels({ tool: 'edit_file', path: 'a.ts', diff: '' })).toContain('a.ts');
    expect(labels({ tool: 'fetch', url: 'https://x.com/a' })).toContain('x.com');
  });

  it('numbers yes, always, no in order', () => {
    const opts = approvalOptions({ tool: 'shell', command: 'ls', cwd: '/' });
    expect(opts.map((o) => o.decision)).toEqual(['yes', 'always', 'no']);
  });
});

describe('DiffPreview', () => {
  it('numbers lines and marks additions and removals', () => {
    const out = plain(render(<DiffPreview diff={DIFF} width={60} />).lastFrame());
    expect(out).toMatch(/10 -\s+const a = 1;/);
    expect(out).toMatch(/10 \+\s+const a = 2;/);
    expect(out).toMatch(/11\s+const b = 3;/);
  });

  it('counts and describes changes', () => {
    expect(diffStats(DIFF)).toEqual({ added: 1, removed: 1 });
    expect(describeDiffStats({ added: 3, removed: 0 })).toBe('3 additions');
  });
});

describe('Footer', () => {
  it('stays quiet until context is filling up', () => {
    expect(contextHint({ used: 10, max: 100, ratio: 0.1 }, 0.75)).toBeNull();
    expect(contextHint({ used: 73, max: 100, ratio: 0.73 }, 0.75)?.text).toBe(
      'Context left until auto-compact: 3%',
    );
  });

  it('shows the shortcut hint and the model', () => {
    const out = plain(
      render(
        <Footer
          inputEmpty
          context={null}
          compactThreshold={null}
          providerLabel="ollama · qwen3.6"
        />,
      ).lastFrame(),
    );
    expect(out).toContain('? for shortcuts');
    expect(out).toContain('ollama · qwen3.6');
  });
});

describe('markdown', () => {
  it('parses headings, lists and code fences', () => {
    const blocks = parseBlocks('# Title\n\n- a\n- b\n\n```ts\nconst x = 1;\n```');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'code']);
    expect(stripInline('use **bold** and `code`')).toBe('use bold and code');
  });
});

describe('CommandSuggestions', () => {
  it('lists triggers and descriptions', () => {
    const items = [
      { trigger: '/compact', description: 'Reclaim context', insert: '/compact' },
      { trigger: '/context', description: 'Show usage', insert: '/context' },
    ];
    const out = plain(render(<CommandSuggestions items={items} selected={1} />).lastFrame());
    expect(out).toContain('/compact');
    expect(out).toContain('/context');
    expect(out).toContain('Show usage');
  });

  it('renders nothing when there are no items', () => {
    expect(plain(render(<CommandSuggestions items={[]} selected={0} />).lastFrame())).toBe('');
  });
});

describe('toolTitle', () => {
  it('labels memory calls readably', async () => {
    const { toolTitle } = await import('../../src/cli/components/ToolLine.js');
    expect(toolTitle('memory', { action: 'save', scope: 'user', note: 'use pnpm' })).toEqual({
      verb: 'Remember',
      detail: 'user · use pnpm',
    });
    expect(toolTitle('memory', { action: 'read', topic: 'testing' }).verb).toBe('Recall');
  });
});
