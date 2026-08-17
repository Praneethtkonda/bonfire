import { tool } from 'ai';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { requestApproval } from './approval.js';
import { isApprovalRemembered, rememberApproval } from './remembered.js';
import { checkHost } from './net-guard.js';

const MAX_BYTES = 200_000;
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

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

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  /** Injectable so tests never touch real DNS. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** Overrides the config lookup; used by tests. */
  policy?: { allowPrivateNetwork: boolean; requireApproval: boolean };
}

async function resolvePolicy(deps: FetchDeps) {
  if (deps.policy) return deps.policy;
  const cfg = await loadConfig();
  return {
    allowPrivateNetwork: cfg.security?.fetch?.allowPrivateNetwork ?? false,
    requireApproval: cfg.security?.fetch?.requireApproval ?? false,
  };
}

export async function fetchUrl(
  args: { url: string; raw?: boolean },
  deps: FetchDeps = {},
): Promise<Record<string, unknown>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const policy = await resolvePolicy(deps);

  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    return { error: `invalid URL: ${args.url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `unsupported protocol: ${parsed.protocol}` };
  }

  if (policy.requireApproval && !isApprovalRemembered('fetch', parsed.origin)) {
    const decision = await requestApproval({ tool: 'fetch', url: parsed.toString() });
    if (decision === 'no') return { url: parsed.toString(), status: 'skipped' };
    if (decision === 'always') rememberApproval('fetch', parsed.origin);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = parsed;
    let res: Response | null = null;

    // Redirects are followed by hand so every hop is re-checked. With
    // `redirect: 'follow'` a public host could bounce the request straight to
    // 169.254.169.254 and the guard would never see it.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!policy.allowPrivateNetwork) {
        const check = await checkHost(current.hostname, deps.resolveHost);
        if (!check.allowed) {
          return {
            error: `blocked by network policy: ${check.reason}. Set security.fetch.allowPrivateNetwork to allow this.`,
            url: current.toString(),
          };
        }
      }

      res = await doFetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'bonfire-fetch/0.1' },
      });

      const location =
        res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        return {
          error: `too many redirects (>${MAX_REDIRECTS})`,
          url: current.toString(),
        };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { error: `invalid redirect target: ${location}` };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { error: `unsupported redirect protocol: ${next.protocol}` };
      }
      current = next;
    }

    if (!res) return { error: 'no response' };

    const contentType = res.headers.get('content-type') ?? '';
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > MAX_BYTES;
    const slice = truncated ? buf.slice(0, MAX_BYTES) : buf;
    let body = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    if (!args.raw && /text\/html|application\/xhtml/i.test(contentType)) {
      body = stripHtml(body);
    }
    return {
      url: res.url || current.toString(),
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
}

export const fetchUrlTool = tool({
  description:
    'Fetch the contents of a URL over HTTP(S). Returns response text (HTML stripped to readable text by default). Use for reading docs, API responses, or web pages referenced by the user. Private, loopback and link-local addresses are blocked by default.',
  inputSchema: z.object({
    url: z.string().describe('Absolute http:// or https:// URL to fetch'),
    raw: z
      .boolean()
      .default(false)
      .describe('Return raw response body without stripping HTML'),
  }),
  execute: async ({ url, raw }) => fetchUrl({ url, raw }),
});
