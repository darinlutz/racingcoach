import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isRgbw, type Rgbw } from './model.ts';
import type { LightingProvider } from './providers.ts';
import type { LightingRuntime } from './runtime.ts';
import { MODES, type Mode } from './stateMachine.ts';
import { UI_HTML } from './ui.ts';

// The agent's local API (docs/lighting/README.md, Local API): for the CLI, Stream Deck buttons and the small local
// page. It listens on 127.0.0.1 only, so nothing on the network can reach it, and every request but /health and the
// page itself needs the token in ~/Library/Application Support/RacingCoachLighting/local-token
// (Authorization: Bearer). Requests must name 127.0.0.1 or localhost as their Host (so a web page can't reach it by
// pointing a domain name at 127.0.0.1), and a browser's cross-site request is refused by its Origin.

export const LOCAL_PORT = 8750;
const MAX_BODY = 16_384;

export function hexColor(hex: string): Rgbw | null {
  const m = hex.replace(/^#/, '').match(/^([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return null;
  const n = (i: number) => parseInt(m[1].slice(i, i + 2), 16);
  return [n(0), n(2), n(4), m[2] ? parseInt(m[2], 16) : 0];
}

const allowedHost = (host: string | undefined, port: number) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

function tokenMatches(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function startLocalApi(runtime: LightingRuntime, token: string, version: string, port = LOCAL_PORT): Server {
  const send = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHost(req.headers.host, port)) return send(res, 421, { error: 'Use 127.0.0.1' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: 'Cross-site request' });
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, version });
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          'X-Frame-Options': 'DENY',
        });
        return res.end(UI_HTML);
      }

      const auth = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? '';
      if (!tokenMatches(auth, token)) return send(res, 401, { error: 'Missing or wrong local token' });

      const input = req.method === 'POST' ? await body(req) : {};
      const segments = path.split('/').filter(Boolean);

      if (req.method === 'GET' && path === '/status') return send(res, 200, { version, ...runtime.status() });
      if (req.method === 'GET' && path === '/zones') return send(res, 200, { zones: runtime.status().zones });
      if (req.method === 'GET' && path === '/scenes') return send(res, 200, { scenes: runtime.config.scenes.map((s) => ({ id: s.id, name: s.name })), active: runtime.sceneId });
      if (req.method === 'GET' && path === '/diagnostics') return send(res, 200, { diagnostics: runtime.recentDiagnostics() });
      if (req.method === 'GET' && path === '/controllers') {
        return send(res, 200, { controllers: runtime.config.controllers.map((c) => ({ ...c, ...runtime.status().controllers.find((s) => s.id === c.id) })) });
      }
      if (req.method === 'POST' && segments[0] === 'controllers' && segments[2] === 'test') {
        const provider: LightingProvider | undefined = runtime.providers.get(segments[1]);
        if (!provider) return send(res, 404, { error: 'No such controller' });
        const started = Date.now();
        try {
          const info = await provider.info();
          return send(res, 200, { ok: true, latencyMs: Date.now() - started, info });
        } catch (error) {
          return send(res, 200, { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (req.method === 'POST' && segments[0] === 'zones' && segments[2] === 'state') {
        const color = typeof input.color === 'string' ? hexColor(input.color) : isRgbw(input.color) ? input.color : undefined;
        if (input.color !== undefined && !color) return send(res, 400, { error: 'color is RRGGBB, RRGGBBWW or [r,g,b,w]' });
        const ok = runtime.changeZone(segments[1], {
          toggle: input.toggle === true,
          on: typeof input.on === 'boolean' ? input.on : undefined,
          color: color ?? undefined,
          brightness: typeof input.brightness === 'number' ? input.brightness : undefined,
          effect: typeof input.effect === 'number' ? input.effect : undefined,
        });
        return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such zone' });
      }
      if (req.method === 'POST' && segments[0] === 'scenes' && segments[2] === 'activate') {
        return runtime.activateScene(segments[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such scene' });
      }
      if (req.method === 'POST' && path === '/mode') {
        const mode = String(input.mode ?? '').toUpperCase() as Mode;
        if (!MODES.includes(mode)) return send(res, 400, { error: `mode is one of ${MODES.join(', ')}` });
        runtime.setMode(mode);
        return send(res, 200, { ok: true, mode });
      }
      if (req.method === 'POST' && path === '/brightness') {
        const value =
          input.action === 'increase' ? runtime.masterBrightness + 0.1 : input.action === 'decrease' ? runtime.masterBrightness - 0.1 : typeof input.percent === 'number' ? input.percent / 100 : NaN;
        if (!Number.isFinite(value)) return send(res, 400, { error: 'action increase|decrease, or percent 0-100' });
        runtime.setMasterBrightness(value);
        return send(res, 200, { ok: true, masterBrightness: runtime.masterBrightness });
      }
      if (req.method === 'POST' && path === '/test/pit-limiter') {
        runtime.testEvent('pitLimiter', input.active === true);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (path === '/all-off' || path === '/all-on')) {
        runtime.setAllOff(path === '/all-off');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/restore') {
        if (input.what === 'defaults') runtime.restoreDefaults();
        else runtime.restoreBaseline();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
