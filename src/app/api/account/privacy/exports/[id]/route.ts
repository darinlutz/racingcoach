import { NextResponse } from 'next/server';
import { getDictionary } from '@/lib/i18n/server';
import { openExportForUser } from '@/lib/personalDataExport';
import { getCurrentUser } from '@/lib/session';

// Download My Data's file: the ZIP, for the signed-in user who asked for it, while it hasn't expired. Sent through the
// server (never a presigned link that would work for anyone holding it); 404 for anyone else's export.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const t = getDictionary(user?.preferredLanguage ?? 'en').privacyRights.errors;
  try {
    if (!user) return NextResponse.json({ error: t.logIn }, { status: 401 });
    const { id } = await params;
    const file = await openExportForUser(user.id, id);
    if (!file) return NextResponse.json({ error: t.notFound }, { status: 404 });
    const body: BodyInit = Buffer.isBuffer(file.body) ? new Uint8Array(file.body) : (file.body as ReadableStream);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(file.sizeBytes),
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Export download error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: t.failed }, { status: 500 });
  }
}
