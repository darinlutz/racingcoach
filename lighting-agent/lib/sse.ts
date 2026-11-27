// A Server-Sent Events parser for the website's lighting stream (GET /api/lighting/events): feed it text as it
// arrives, in any pieces, and it calls back once per complete event. Pure; follows the WHATWG event stream format
// (fields event, data, id, retry; comments start with ':'; an empty line ends an event).

export type SseMessage = { event: string; data: string; id: string | null };

export class SseParser {
  private buffer = '';
  private eventType = '';
  private data: string[] = [];
  private lastId: string | null = null;
  retryMs: number | null = null;
  private readonly onMessage: (message: SseMessage) => void;

  constructor(onMessage: (message: SseMessage) => void) {
    this.onMessage = onMessage;
  }

  // The id of the last event that had one, for Last-Event-ID when reconnecting
  get lastEventId(): string | null {
    return this.lastId;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    // A huge line without an end is refused rather than kept growing
    if (this.buffer.length > 1_000_000) throw new Error('Event stream line too long');
    let end: number;
    while ((end = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, end);
      const newline = this.buffer.startsWith('\r\n', end) ? 2 : 1;
      // A \r at the very end may be half of \r\n: wait for the next piece
      if (this.buffer[end] === '\r' && end === this.buffer.length - 1) break;
      this.buffer = this.buffer.slice(end + newline);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') {
      if (this.data.length) this.onMessage({ event: this.eventType || 'message', data: this.data.join('\n'), id: this.lastId });
      this.eventType = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventType = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retryMs = Number(value);
  }
}
