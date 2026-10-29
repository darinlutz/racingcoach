import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getTvSession, isTvSessionActive } from '@/lib/tvAuth';
import { readTvState } from '@/lib/tvBroadcast';

// TV Broadcast Mode's live race, as Server-Sent Events (src/lib/tvBroadcast.ts): the picture of the race whenever it
// changes (checked every second), a ping event every KEEPALIVE_MS so proxies keep the connection open, and an unpaired
// event when the TV session is revoked or expires (checked every CHECK_SESSION_MS). The stream ends after
// MAX_STREAM_MS and the browser's EventSource reconnects, so a long broadcast never holds one request for hours.
// ?driver=<userId> picks the driver to follow. Cache-Control no-transform keeps the response from being compressed,
// which would hold the events back; X-Accel-Buffering: no does the same for proxies that honor it.

const TICK_MS = 1000;
const KEEPALIVE_MS = 15_000;
const CHECK_SESSION_MS = 15_000;
const MAX_STREAM_MS = 10 * 60_000;

export async function GET(request: Request) {
  const session = await getTvSession();
  if (!session) {
    const t = getDictionary(await getLanguage(null)).tv;
    return NextResponse.json({ error: t.notPaired, code: 'notPaired' }, { status: 401 });
  }
  const driverParam = Number(new URL(request.url).searchParams.get('driver'));
  const driver = Number.isInteger(driverParam) && driverParam > 0 ? driverParam : null;
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let lastSent = '';
      let lastWrite = 0;
      let lastCheck = started;
      let open = true;
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
          lastWrite = Date.now();
        } catch {
          open = false;
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the browser going away
        }
      };
      signal.addEventListener('abort', close);
      // Ask the browser to reconnect after 3 s when the stream drops
      write('retry: 3000\n\n');

      while (open && !signal.aborted) {
        const now = Date.now();
        if (now - started > MAX_STREAM_MS) break;
        if (now - lastCheck > CHECK_SESSION_MS) {
          lastCheck = now;
          if (!(await isTvSessionActive(session.id).catch(() => true))) {
            write('event: unpaired\ndata: {}\n\n');
            break;
          }
        }
        try {
          const state = await readTvState(session.user, driver);
          // The picture without its timestamp, to see whether anything changed
          const { at, ...rest } = state;
          const key = JSON.stringify(rest);
          if (key !== lastSent) {
            lastSent = key;
            write(`data: ${JSON.stringify({ at, ...rest })}\n\n`);
          } else if (now - lastWrite > KEEPALIVE_MS) {
            // An event, not a comment, so the TV's watchdog sees the stream is alive
            write('event: ping\ndata: {}\n\n');
          }
        } catch (error) {
          console.error('TV stream error:', error);
          write('event: problem\ndata: {}\n\n');
        }
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));
      }
      signal.removeEventListener('abort', close);
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
