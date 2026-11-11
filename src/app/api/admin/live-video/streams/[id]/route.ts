import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { deleteLiveInput, streamSetup } from '@/lib/liveVideo/cloudflareStream';
import { readStream, removeStream, updateStream } from '@/lib/liveVideoDb';
import { JSON_BODY_LIMIT, readJsonLimited } from '@/lib/requestBody';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// One live stream (docs/live-video.md). PATCH { enabled?, requireSigned?, name? }. DELETE removes it from the site, and
// with ?deleteInput=1 also deletes the live input in Cloudflare when the site created it. Admin role only; 404 otherwise.

const patchSchema = z.object({ enabled: z.boolean().optional(), requireSigned: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional() });

async function idOf(params: Promise<{ id: string }>): Promise<number | null> {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    const v = getDictionary(user.preferredLanguage).liveVideo.api;
    const id = await idOf(params);
    const parsed = patchSchema.safeParse(await readJsonLimited(request, JSON_BODY_LIMIT).catch(() => null));
    if (!id || !parsed.success) return NextResponse.json({ error: v.invalidDetails }, { status: 400 });
    if (parsed.data.requireSigned && !streamSetup().signing) return NextResponse.json({ error: v.signingNotConfigured }, { status: 409 });
    const stream = await updateStream(id, parsed.data);
    if (!stream) return NextResponse.json({ error: v.streamNotFound }, { status: 404 });
    console.log(`Live video: stream ${id} changed by user ${user.id}`);
    return NextResponse.json({ stream });
  } catch (error) {
    console.error('Live video update stream error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    const v = getDictionary(user.preferredLanguage).liveVideo.api;
    const id = await idOf(params);
    if (!id) return NextResponse.json({ error: v.invalidDetails }, { status: 400 });
    const stream = await readStream(id);
    if (!stream) return NextResponse.json({ error: v.streamNotFound }, { status: 404 });
    const deleteInput = new URL(request.url).searchParams.get('deleteInput') === '1' && stream.createdVia === 'api';
    if (deleteInput) {
      try {
        await deleteLiveInput(stream.inputId);
      } catch (error) {
        console.error('Live video Cloudflare delete error:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: v.cloudflareFailed }, { status: 502 });
      }
    }
    await removeStream(id);
    console.log(`Live video: stream ${id} removed by user ${user.id}${deleteInput ? ' (input deleted in Cloudflare)' : ''}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Live video remove stream error:', error);
    return NextResponse.json({ error: t.failedSaveSetting }, { status: 500 });
  }
}
