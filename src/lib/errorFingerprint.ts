// Grouping and cleaning server errors for the error monitor (src/lib/errorMonitor.ts). No imports, so tests run it
// directly. An error's group (fingerprint) is its message with what changes from one occurrence to the next taken
// out: IDs, numbers, quoted values. Its text is scrubbed before it's stored or emailed: email addresses, long tokens
// and keys, and URL query strings, so the error log holds no one's personal data or secrets.

const MAX_MESSAGE = 500;
const MAX_DETAIL = 4000;

// Personal data and secrets that can turn up in an error's text
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(sk|rk|pk|whsec|re|ghp|xox[a-z])[-_][A-Za-z0-9_-]{8,}/g, '[key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .replace(/([?&][\w.-]+=)[^&\s"']*/g, '$1[…]')
    .replace(/(postgres(ql)?:\/\/)[^@\s]+@/gi, '$1[credentials]@');
}

// The error's group: the same mistake from different requests gives the same fingerprint
export function fingerprint(source: string, message: string): string {
  const normal = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\[(email|key|token|credentials|…)\]/g, '<x>')
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<s>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<n>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return `${source.slice(0, 80)}|${normal}`;
}

// What console.error or a request error was given, as a message (the first line people read) and the detail
// (stacks), both scrubbed and cut to size
export function describeError(args: unknown[]): { message: string; detail: string } {
  const parts: string[] = [];
  const stacks: string[] = [];
  for (const arg of args) {
    if (arg instanceof Error) {
      parts.push(`${arg.name}: ${arg.message}`);
      if (arg.stack) stacks.push(arg.stack);
      const cause = (arg as Error & { cause?: unknown }).cause;
      if (cause instanceof Error) parts.push(`(cause ${cause.name}: ${cause.message})`);
    } else if (typeof arg === 'string') {
      parts.push(arg);
    } else {
      try {
        parts.push(JSON.stringify(arg)?.slice(0, 300) ?? String(arg));
      } catch {
        parts.push(String(arg));
      }
    }
  }
  const message = scrub(parts.join(' ').replace(/\s+/g, ' ').trim()).slice(0, MAX_MESSAGE);
  const detail = scrub(stacks.join('\n\n')).slice(0, MAX_DETAIL);
  return { message: message || '(no message)', detail };
}
