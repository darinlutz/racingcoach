import { NextResponse } from 'next/server';
import { ApiError, memoryRoute } from '@/lib/memory/api';
import { readExport } from '@/lib/memory/importExport';
import { audit } from '@/lib/memory/store';

type Ctx = { params: Promise<{ id: string }> };

// The file itself, only to the Admin who made it, within 72 hours; never a storage URL
export const GET = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 30 }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  const file = await readExport(id, caller.user.id);
  if (!file) throw new ApiError(404, 'notFound');
  await audit(caller.actor, 'export.download', id, 'ok');
  const type = file.format === 'csv' ? 'text/csv; charset=utf-8' : file.format === 'json' ? 'application/json' : 'application/x-ndjson';
  return new NextResponse(new Uint8Array(file.content), { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`, 'cache-control': 'no-store' } });
});
