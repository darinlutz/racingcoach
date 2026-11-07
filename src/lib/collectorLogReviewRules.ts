// The collector log review's limits (src/lib/collectorLogReview.ts), with no imports so tests run them directly.
// The review is the site's own AI call, paid by the site and never counted against the user, and the log text and
// run ID come from the collector, so anyone with an upload key could otherwise start any number of them. These cap
// it: reviews per user and in all over the last 24 hours, and how much of the log goes into the prompt.

export const MAX_REVIEWS_PER_USER_PER_DAY = 3;
export const MAX_REVIEWS_PER_DAY = 100;
export const MAX_PENDING_REVIEWS = 500;
export const MAX_PROMPT_LINE_CHARS = 500;
export const MAX_PROMPT_LOG_CHARS = 24_000;

// The lines that go into the prompt, each cut short, newest kept when they don't all fit
export function promptLines(lines: string[]): string[] {
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].length > MAX_PROMPT_LINE_CHARS ? `${lines[i].slice(0, MAX_PROMPT_LINE_CHARS)}…` : lines[i];
    if (total + line.length + 1 > MAX_PROMPT_LOG_CHARS) break;
    kept.unshift(line);
    total += line.length + 1;
  }
  return kept;
}
