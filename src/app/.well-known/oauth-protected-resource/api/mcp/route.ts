import { NextResponse } from 'next/server';

export function GET() {
  const issuer = process.env.MCP_OAUTH_ISSUER;
  const resource = process.env.MCP_RESOURCE_URL;
  if (!issuer || !resource) return NextResponse.json({ error: 'MCP OAuth is not configured' }, { status: 503 });
  return NextResponse.json({
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['tracks:read', 'tracks:write'],
    bearer_methods_supported: ['header'],
  }, { headers: { 'Cache-Control': 'no-store' } });
}
