import { resolveProvider, type ResolvedProvider } from '../providers/index.js';

const DEBUG = process.env.BONFIRE_DEBUG === '1';

/** Header names whose values are redacted in debug logs. */
const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth-token|cookie)$/i;

function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const obj =
    headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : Array.isArray(headers)
        ? Object.fromEntries(headers)
        : (headers as Record<string, string>);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_HEADER_RE.test(k) ? '[redacted]' : v;
  }
  return out;
}

const debugFetch: typeof fetch = async (input, init) => {
  if (DEBUG && init?.body) {
    try {
      const body = JSON.parse(String(init.body));
      const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const toolNames = (body.tools ?? [])
        .map((t: { function?: { name?: string } }) => t?.function?.name)
        .join(',');
      const headers = redactHeaders(init.headers);
      console.error(
        `[debug] POST ${input} · tools=${toolCount} [${toolNames}] · headers=${JSON.stringify(headers)}`,
      );
    } catch {
      console.error(`[debug] POST ${input} · (non-json body)`);
    }
  }
  const res = await fetch(input, init);
  if (DEBUG) console.error(`[debug] <- ${res.status}`);
  return res;
};

let cached: ResolvedProvider | null = null;

export async function getProvider(): Promise<ResolvedProvider> {
  if (!cached) cached = await resolveProvider({ fetchImpl: debugFetch });
  return cached;
}

export async function describeProvider(): Promise<string> {
  return (await getProvider()).label;
}
