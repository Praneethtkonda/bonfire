import { tool } from 'ai';
import { z } from 'zod';

const MAX_BYTES = 200_000;
const TIMEOUT_MS = 30_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export const fetchUrlTool = tool({
  description:
    'Fetch the contents of a URL over HTTP(S). Returns response text (HTML stripped to readable text by default). Use for reading docs, API responses, or web pages referenced by the user.',
  inputSchema: z.object({
    url: z.string().describe('Absolute http:// or https:// URL to fetch'),
    raw: z
      .boolean()
      .default(false)
      .describe('Return raw response body without stripping HTML'),
  }),
  execute: async ({ url, raw }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `invalid URL: ${url}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `unsupported protocol: ${parsed.protocol}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'bonfire-fetch/0.1' },
      });
      const contentType = res.headers.get('content-type') ?? '';
      const buf = await res.arrayBuffer();
      const truncated = buf.byteLength > MAX_BYTES;
      const slice = truncated ? buf.slice(0, MAX_BYTES) : buf;
      let body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      if (!raw && /text\/html|application\/xhtml/i.test(contentType)) {
        body = stripHtml(body);
      }
      return {
        url: res.url,
        status: res.status,
        contentType,
        truncated,
        body,
      };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return { error: `request timed out after ${TIMEOUT_MS}ms` };
      }
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  },
});
