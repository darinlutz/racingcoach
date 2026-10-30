import { NextResponse } from 'next/server';
import { createEngineAudioAsset, listEngineAudioAssets } from '@/lib/engineAudioAssets';
import { MAX_ENGINE_AUDIO_BYTES, sniffEngineAudio } from '@/lib/engineBedConfig';
import { apiText, getDictionary } from '@/lib/i18n/server';
import { videoStorageConfigured } from '@/lib/objectStorage';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

const MAX_NAME = 100;

// The Admin page's Engine Sounds (src/lib/engineAudioAssets.ts). GET lists them. POST (multipart: file, an MP3 or WAV,
// and name) uploads one, to the same object storage as the Broadcast Video Library, through this route so the file is
// checked before it's stored. Admin role only; anyone else gets a 404.

export async function GET() {
  const user = await getCurrentUser();
  const t = await apiText(user);
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    return NextResponse.json({ assets: await listEngineAudioAssets(), storageConfigured: videoStorageConfigured() });
  } catch (error) {
    console.error('Engine sound list error:', error);
    return NextResponse.json({ error: getDictionary(user?.preferredLanguage ?? 'en').admin.engineAudio.failedLoad }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const t = await apiText(user);
  const e = getDictionary(user?.preferredLanguage ?? 'en').admin.engineAudio;
  try {
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: t.adminOnly }, { status: 404 });
    }
    if (!videoStorageConfigured()) {
      return NextResponse.json({ error: e.storageMissing, code: 'storageMissing' }, { status: 503 });
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: e.unsupportedFile, code: 'unsupported' }, { status: 400 });
    }
    if (file.size > MAX_ENGINE_AUDIO_BYTES) {
      return NextResponse.json({ error: e.fileTooLarge, code: 'tooLarge' }, { status: 413 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = sniffEngineAudio(bytes);
    if (!contentType) {
      return NextResponse.json({ error: e.unsupportedFile, code: 'unsupported' }, { status: 415 });
    }
    const typed = form?.get('name');
    const name = (typeof typed === 'string' && typed.trim() ? typed.trim() : file.name.replace(/\.[^.]*$/, '')).slice(0, MAX_NAME);
    return NextResponse.json({ asset: await createEngineAudioAsset(name, bytes, contentType, user.id) }, { status: 201 });
  } catch (error) {
    console.error('Engine sound upload error:', error);
    return NextResponse.json({ error: e.failedSave }, { status: 500 });
  }
}
