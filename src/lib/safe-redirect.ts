// Where to send someone after they sign in. Only same-site paths are accepted, so a crafted
// "?next=" link cannot bounce a user to another website.
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return fallback;

  // Browsers ignore tabs/newlines and treat "\" like "/" in URLs, which could turn "/\evil.com"
  // or "/\t/evil.com" into "//evil.com" (another site).
  if (/[\u0000-\u001F\u007F\\]/.test(next) || next.startsWith('//')) return fallback;

  const base = 'http://app.invalid';
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
