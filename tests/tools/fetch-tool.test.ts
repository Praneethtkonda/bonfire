import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUrlTool } from '../../src/tools/fetch-tool.js';

interface ExecArgs {
  url: string;
  raw?: boolean;
}

interface MaybeExec {
  execute?: (args: ExecArgs, ctx?: unknown) => Promise<any>;
}

async function exec(args: ExecArgs): Promise<any> {
  const t = fetchUrlTool as unknown as MaybeExec;
  if (!t.execute) throw new Error('fetchUrlTool has no execute');
  return t.execute(args);
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function textResponse(body: string, contentType = 'text/plain') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchUrlTool URL validation', () => {
  it('rejects an invalid URL string', async () => {
    const result = await exec({ url: 'not-a-url' });
    expect(result.error).toMatch(/invalid URL/);
  });

  it('rejects unsupported protocols', async () => {
    expect((await exec({ url: 'file:///etc/passwd' })).error).toMatch(
      /unsupported protocol/,
    );
    expect((await exec({ url: 'ftp://example.com' })).error).toMatch(
      /unsupported protocol/,
    );
  });
});

describe('fetchUrlTool HTML stripping', () => {
  it('strips tags and normalizes whitespace by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        htmlResponse(
          '<html><body><h1>Hello</h1><p>World &amp; everyone</p></body></html>',
        ),
      ),
    );
    const result = await exec({ url: 'https://example.com' });
    expect(result.body).toContain('Hello');
    expect(result.body).toContain('World & everyone');
    expect(result.body).not.toContain('<h1>');
  });

  it('removes <script> and <style> blocks completely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        htmlResponse(
          '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body>Visible</body></html>',
        ),
      ),
    );
    const result = await exec({ url: 'https://example.com' });
    expect(result.body).toContain('Visible');
    expect(result.body).not.toContain('alert');
    expect(result.body).not.toContain('color:red');
  });

  it('decodes common HTML entities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        htmlResponse('<p>&lt;tag&gt; &quot;quoted&quot; &#39;tick&#39; &nbsp;end</p>'),
      ),
    );
    const result = await exec({ url: 'https://example.com' });
    expect(result.body).toContain('<tag>');
    expect(result.body).toContain('"quoted"');
    expect(result.body).toContain("'tick'");
  });

  it('preserves raw HTML when raw=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(htmlResponse('<p>raw <b>bold</b></p>')),
    );
    const result = await exec({ url: 'https://example.com', raw: true });
    expect(result.body).toContain('<p>raw <b>bold</b></p>');
  });

  it('does not strip non-HTML content types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        textResponse('{"key":"value"}', 'application/json'),
      ),
    );
    const result = await exec({ url: 'https://example.com/api' });
    expect(result.body).toBe('{"key":"value"}');
  });
});

describe('fetchUrlTool size cap', () => {
  it('truncates response bodies larger than the cap and reports truncated=true', async () => {
    const big = 'x'.repeat(300_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(textResponse(big, 'text/plain')),
    );
    const result = await exec({ url: 'https://example.com/big' });
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(200_000);
  });

  it('reports truncated=false for small responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(textResponse('small body', 'text/plain')),
    );
    const result = await exec({ url: 'https://example.com/small' });
    expect(result.truncated).toBe(false);
  });
});

describe('fetchUrlTool error handling', () => {
  it('surfaces network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED 1.2.3.4:80')),
    );
    const result = await exec({ url: 'https://example.com' });
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('reports a friendly timeout message when fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }),
    );
    const result = await exec({ url: 'https://example.com' });
    expect(result.error).toMatch(/timed out/);
  });

  it('returns status code from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Not found', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );
    const result = await exec({ url: 'https://example.com/missing' });
    expect(result.status).toBe(404);
    expect(result.body).toBe('Not found');
  });
});
