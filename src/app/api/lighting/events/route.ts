import { authenticateLightingDevice } from '@/lib/lighting/devices';
import { parseStreamPosition, streamPosition, type LightingEvent } from '@/lib/lighting/events';
import { lightingEventsAfter, lightingSnapshot, subscribeLighting } from '@/lib/lighting/hub';
import { lightingDevice } from '@/lib/lighting/routeHelpers';

// The lighting agent's live events, as Server-Sent Events (src/lib/lighting/events.ts has the contract). Only the
// device's own account's driver: nothing in the request picks it. The Mac connects out to the site, so it needs no
// open port.
//
// On connecting: with a Last-Event-ID ("<epoch>:<sequence>") the server still has the events after, those events;
// otherwise a `snapshot` event, the whole state now, which replaces whatever the agent had. Then each event as it
// happens (pushed, not polled), with id: set for resuming; a `heartbeat` event every HEARTBEAT_MS with the telemetry's
// age, so the agent sees both the stream and the collector are alive; `reauth` when the access token has run out or
// the device was revoked. The stream ends after MAX_STREAM_MS and the agent reconnects. Cache-Control no-transform and
// X-Accel-Buffering: no keep proxies from holding events back.

const HEARTBEAT_MS = 2_000;
const CHECK_TOKEN_MS = 30_000;
const MAX_STREAM_MS = 10 * 60_000;

export async function GET(request: Request) {
  const auth = await lightingDevice(request);
  if (auth.response) return auth.response;
  const { userId } = auth.device;
  const resumeFrom = parseStreamPosition(request.headers.get('last-event-id'));
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      const sendEvent = (event: LightingEvent) =>
        write(`id: ${streamPosition(event)}\nevent: lighting\ndata: ${JSON.stringify(event)}\n\n`);
      const sendSnapshot = () => {
        const snapshot = lightingSnapshot(userId);
        write(`id: ${snapshot.epoch}:${snapshot.sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      };

      // Subscribe before reading the history, so nothing falls between; the history's events are skipped live
      const queued: LightingEvent[] = [];
      let replayed = false;
      let lastSequence = 0;
      const unsubscribe = subscribeLighting(userId, (event) => {
        if (!replayed) queued.push(event);
        else if (event.sequence > lastSequence) {
          lastSequence = event.sequence;
          sendEvent(event);
        }
      });

      write('retry: 2000\n\n');
      const missed = resumeFrom ? lightingEventsAfter(userId, resumeFrom.epoch, resumeFrom.sequence) : null;
      if (missed) {
        for (const event of missed) sendEvent(event);
        lastSequence = missed.length ? missed[missed.length - 1].sequence : resumeFrom!.sequence;
      } else {
        sendSnapshot();
        lastSequence = lightingSnapshot(userId).sequence;
      }
      for (const event of queued) {
        if (event.sequence <= lastSequence) continue;
        lastSequence = event.sequence;
        sendEvent(event);
      }
      replayed = true;

      const started = Date.now();
      let lastCheck = started;
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the agent going away
        }
      };
      signal.addEventListener('abort', close);
      while (open && !signal.aborted && Date.now() - started < MAX_STREAM_MS) {
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS));
        if (Date.now() - lastCheck > CHECK_TOKEN_MS) {
          lastCheck = Date.now();
          const still = await authenticateLightingDevice(request).catch(() => auth.device);
          if (!still) {
            write('event: reauth\ndata: {}\n\n');
            break;
          }
        }
        const snapshot = lightingSnapshot(userId);
        write(
          `event: heartbeat\ndata: ${JSON.stringify({
            epoch: snapshot.epoch,
            sequence: snapshot.sequence,
            serverTimeUtc: snapshot.serverTimeUtc,
            telemetryAgeMs: snapshot.live?.telemetryAgeMs ?? null,
            fresh: snapshot.live?.fresh ?? false,
          })}\n\n`
        );
      }
      unsubscribe();
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
