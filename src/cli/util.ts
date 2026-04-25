export function truncate(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
