import { carModelStore, CAR_MODEL_CONTENT_TYPE } from '@/lib/carModels/carModelStorage';
import { readCarModelFile } from '@/lib/carModels/carModelStore';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

// A 3D car model's GLB file (docs/car-models.md), sent through the site after its own check rather than a redirect to
// object storage: no storage URL or credential reaches the browser, and the bucket needs no CORS rule for reads. Any
// signed-in user gets an active, approved version; an Admin any version, for the Admin page's preview. Everyone else,
// and a missing file, 404. The address carries the file's hash (modelFileUrl) and a version's bytes never change, so the
// browser may keep it for a year; Lap Compare's and the Setups page's viewers then share the one download.
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  const raw = (await params).id;
  const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!user || !/^\d{1,9}$/.test(raw)) return notFound();
  const store = carModelStore();
  if (!store) return notFound();
  try {
    const file = await readCarModelFile(Number(raw));
    if (!file || (!file.servable && !isAdmin(user.role))) return notFound();
    const etag = `"${file.sha256}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    const { body } = await store.stream(file.storageKey);
    return new Response(body, {
      headers: {
        'Content-Type': CAR_MODEL_CONTENT_TYPE,
        'Content-Length': String(file.bytes),
        // Drafts are never kept: an Admin's preview of one must not linger in a shared browser
        'Cache-Control': file.servable ? 'private, max-age=31536000, immutable' : 'private, no-store',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { code?: string }).code === 'ENOENT') {
      console.error(`Car model ${raw}'s file is missing from object storage`);
      return notFound();
    }
    console.error('Car model file error:', error);
    return new Response(null, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
