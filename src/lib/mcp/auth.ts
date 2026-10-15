import { createPublicKey, verify } from 'node:crypto';

type Claims = { iss?: string; aud?: string | string[]; sub?: string; exp?: number; nbf?: number; scope?: string; scp?: string[]; permissions?: string[] };
type Jwk = JsonWebKey & { kid?: string; kty?: string; alg?: string; use?: string };
let cached: { keys: Jwk[]; until: number } | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing MCP configuration: ${name}`);
  return value;
}
function decode(input: string): unknown {
  return JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
}
async function keys(): Promise<Jwk[]> {
  if (cached && cached.until > Date.now()) return cached.keys;
  const url = new URL(required('MCP_JWKS_URL'));
  if (url.protocol !== 'https:') throw new Error('MCP_JWKS_URL must use HTTPS');
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to retrieve MCP signing keys');
  const body = await response.json() as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new Error('Invalid JWKS');
  cached = { keys: body.keys, until: Date.now() + 300_000 };
  return body.keys;
}
export async function authorize(header: string | null, permission: 'read' | 'write'): Promise<string | null> {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header ?? '');
  if (!match) return null;
  const segments = match[1].split('.');
  if (segments.length !== 3) return null;
  try {
    const [encodedHeader, encodedPayload, signature] = segments;
    const headerData = decode(encodedHeader) as { alg?: string; kid?: string; typ?: string };
    if (headerData.alg !== 'RS256' || !headerData.kid) return null;
    const claims = decode(encodedPayload) as Claims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== required('MCP_OAUTH_ISSUER') ||
        !(typeof claims.aud === 'string' ? claims.aud === required('MCP_OAUTH_AUDIENCE') : claims.aud?.includes(required('MCP_OAUTH_AUDIENCE'))) ||
        !claims.sub || typeof claims.exp !== 'number' || claims.exp <= now ||
        (claims.nbf !== undefined && claims.nbf > now)) return null;
    const jwk = (await keys()).find(k => k.kid === headerData.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    if (!jwk) return null;
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    if (!verify('RSA-SHA256', Buffer.from(encodedHeader + '.' + encodedPayload), publicKey, Buffer.from(signature, 'base64url'))) return null;
    // Bind the identity to a specifically approved OAuth subject. Never trust an arbitrary account's scope alone.
    if (claims.sub !== required('MCP_ALLOWED_SUBJECT')) return null;
    const requiredPermission = permission === 'write' ? 'tracks:write' : 'tracks:read';
    const scopes = new Set([...(claims.scope ?? '').split(' '), ...(claims.scp ?? [])]);
    // Auth0 RBAC permissions must be granted to the user, not merely requested by a client.
    if (!scopes.has(requiredPermission) || !Array.isArray(claims.permissions) || !claims.permissions.includes(requiredPermission)) return null;
    return claims.sub;
  } catch {
    return null;
  }
}
