import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for fetch_url.
 *
 * Without this, the model can be steered — by a user, or by injected text on a
 * page it already fetched — into hitting cloud metadata endpoints
 * (169.254.169.254), services bound to localhost, or hosts inside the user's
 * LAN. Those are exactly the targets that a "local-first" tool sitting on
 * someone's workstation has privileged network access to.
 */

/** Reserved IPv4 ranges expressed as [firstOctet, predicate]. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable — fail closed
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function normalizeIPv6(ip: string): string {
  return ip.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIPv6(raw: string): boolean {
  const ip = normalizeIPv6(raw);
  if (ip === '::' || ip === '::1') return true; // unspecified + loopback
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (ip.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(ip)) return true; // unique local fc00::/7
  if (ip.startsWith('ff')) return true; // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not an IP literal — fail closed
}

export interface HostCheck {
  allowed: boolean;
  reason?: string;
  addresses: string[];
}

/**
 * Resolve `hostname` and report whether every address is publicly routable.
 * Resolution happens here so a hostname that points at 127.0.0.1 is caught —
 * checking the literal string alone is trivially bypassed.
 */
export async function checkHost(
  hostname: string,
  resolver: (h: string) => Promise<string[]> = defaultResolve,
): Promise<HostCheck> {
  const bare = normalizeIPv6(hostname);

  if (isIP(bare)) {
    const priv = isPrivateAddress(bare);
    return {
      allowed: !priv,
      reason: priv ? `${bare} is a private or reserved address` : undefined,
      addresses: [bare],
    };
  }

  // `localhost` and friends may not resolve via DNS in every environment.
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(bare)) {
    return { allowed: false, reason: `${bare} resolves to a local address`, addresses: [] };
  }

  let addresses: string[];
  try {
    addresses = await resolver(bare);
  } catch (e: unknown) {
    return {
      allowed: false,
      reason: `could not resolve ${bare}: ${e instanceof Error ? e.message : String(e)}`,
      addresses: [],
    };
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: `${bare} did not resolve`, addresses: [] };
  }

  const blocked = addresses.filter((a) => isPrivateAddress(a));
  if (blocked.length > 0) {
    return {
      allowed: false,
      reason: `${bare} resolves to a private or reserved address (${blocked.join(', ')})`,
      addresses,
    };
  }
  return { allowed: true, addresses };
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}
