import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/mcp/auth';
import { definitions, runTool } from '@/lib/mcp/trackTools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonRpc(id: unknown, result?: unknown, error?: { code: number; message: string }) {
  return NextResponse.json(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: NextRequest) {
  const subject = await authorize(req.headers.get('authorization'), 'read');
  if (!subject) return new NextResponse('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="/.well-known/oauth-protected-resource/api/mcp"' } });
  let request: { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } };
  try { request = await req.json(); } catch { return jsonRpc(null, undefined, { code: -32700, message: 'Parse error' }); }
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') return jsonRpc(request.id ?? null, undefined, { code: -32600, message: 'Invalid request' });
  if (request.method === 'notifications/initialized') return new NextResponse(null, { status: 202 });
  if (request.method === 'initialize') return jsonRpc(request.id ?? null, { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'racingcoach-tracks', version: '0.1.0' } });
  if (request.method === 'ping') return jsonRpc(request.id ?? null, {});
  if (request.method === 'tools/list') return jsonRpc(request.id ?? null, { tools: definitions });
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    if (!name || !definitions.some(t => t.name === name)) return jsonRpc(request.id ?? null, undefined, { code: -32602, message: 'Unknown tool' });
    if (name === 'insert_track' && !await authorize(req.headers.get('authorization'), 'write')) {
      return jsonRpc(request.id ?? null, { isError: true, content: [{ type: 'text', text: 'Insufficient permission: tracks:write' }] });
    }
    try {
      const result = await runTool(name, request.params?.arguments ?? {}, subject);
      return jsonRpc(request.id ?? null, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (error) {
      const message = error instanceof Error && error.name === 'ZodError' ? 'Invalid tool arguments' : 'Operation failed; consult server logs';
      return jsonRpc(request.id ?? null, { isError: true, content: [{ type: 'text', text: message }] });
    }
  }
  return jsonRpc(request.id ?? null, undefined, { code: -32601, message: 'Method not found' });
}
export async function GET(req: NextRequest) {
  if (!await authorize(req.headers.get('authorization'), 'read')) return new NextResponse('Unauthorized', { status: 401 });
  return new NextResponse('Streaming GET is not supported; use POST', { status: 405 });
}
