import { ChatOpenAI } from '@langchain/openai';
import { LOCAL_MODELS, type LocalModelId } from './config.ts';
import { secretUsable, signRequest } from './signing.ts';

// The website's side of a local AI server's gateway (local-ai/gateway.ts on the Mac, behind Cloudflare Tunnel and
// Access; docs/local-ai.md). Every request carries the Cloudflare Access service token (checked by Cloudflare before
// it reaches the Mac) and an HMAC signature with LOCAL_AI_SHARED_SECRET (checked by the gateway). Both stay on the
// server: nothing here reaches a browser.

export function localAiSecret(): string | null {
  const secret = process.env.LOCAL_AI_SHARED_SECRET;
  return secretUsable(secret) ? secret : null;
}

export function cloudflareAccessHeaders(): Record<string, string> {
  const id = process.env.LOCAL_AI_CF_ACCESS_CLIENT_ID;
  const secret = process.env.LOCAL_AI_CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
}

// fetch, with each request signed and the Access headers added. Only string bodies, which is what the OpenAI SDK
// sends, so the signature always covers exactly the bytes sent.
export function signedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const secret = localAiSecret();
    if (!secret) throw new Error('LOCAL_AI_SHARED_SECRET is not configured (at least 32 characters)');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') {
      throw new Error('Local AI requests must have a string body');
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(signRequest(secret, 'inference', { method: init?.method ?? 'GET', path: url.pathname, body }))) {
      headers.set(name, value);
    }
    for (const [name, value] of Object.entries(cloudflareAccessHeaders())) headers.set(name, value);
    headers.delete('authorization');
    return fetch(url, { ...init, headers, redirect: 'error' });
  };
}

// Answers the profile createAgent reads; the routed model shows the cloud model's instead (routedModel.ts)
class LocalChatModel extends ChatOpenAI {
  get profile() {
    return { ...super.profile, toolCalling: true, structuredOutput: true };
  }
}

export function localChatModel(options: {
  gatewayUrl: string;
  model: LocalModelId;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): ChatOpenAI {
  return new LocalChatModel({
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    // No retries: a failed local call goes to the cloud instead
    maxRetries: 0,
    timeout: options.timeoutMs,
    useResponsesApi: false,
    // The gateway takes no key; its signature is the authentication
    apiKey: 'local-gateway',
    configuration: { baseURL: `${options.gatewayUrl.replace(/\/+$/, '')}/v1`, fetch: signedFetch() },
    modelKwargs: { ...LOCAL_MODELS[options.model].requestExtras },
  });
}

// A signed GET of the gateway's /health, for the test console's Test Local Connectivity
export async function gatewayHealth(gatewayUrl: string, timeoutMs = 5_000): Promise<{ status: number; body: unknown; latencyMs: number }> {
  const started = performance.now();
  const response = await signedFetch()(`${gatewayUrl.replace(/\/+$/, '')}/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = text.slice(0, 2000);
  try {
    body = JSON.parse(text);
  } catch {
    // Cloudflare's own pages (Access login, tunnel down) aren't JSON
  }
  return { status: response.status, body, latencyMs: Math.round(performance.now() - started) };
}

// Where a gateway may be: https in production (the Cloudflare Tunnel's hostname), or http on this computer while
// developing. No path, query or credentials, so nothing else can ride along.
export function validGatewayUrl(value: unknown, production: boolean): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && local && !production) return url.origin;
  return null;
}
