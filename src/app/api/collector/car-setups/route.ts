import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { storeSetup } from '@/lib/carSetupLibrary';
import { CAR_SETUP_LIMITS } from '@/lib/carSetupLibraryRules';
import { adminCollector, carSetupErrorResponse } from '@/lib/carSetupRoutes';
import { BodyTooLargeError, readFormDataLimited } from '@/lib/requestBody';

// Get Car Setups, step 2: one new or changed setup's files (multipart: meta = JSON of the setup as it was listed in
// step 1 with its folder and the import's ID, sto = the .sto, htm = the .htm when it has one), byte for byte. The
// server checks them against the listed hashes and sizes, stores them in R2 and catalogs the setup (carSetupLibrary.ts's
// storeSetup). Answers { setupId, decision, version, htmStatus, written }. Admins only (upload key auth).

const metaSchema = z.object({
  importId: z.number().int().positive(),
  folder: z.string().min(1).max(80),
  path: z.string().min(1).max(CAR_SETUP_LIMITS.pathChars),
  stoFileName: z.string().min(1).max(200),
  stoSha256: z.string().regex(/^[0-9a-f]{64}$/),
  stoBytes: z.number().int().positive(),
  htmFileName: z.string().min(1).max(200).nullish(),
  htmSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  htmBytes: z.number().int().positive().nullish(),
});

const fileBytes = async (value: FormDataEntryValue | null) => (value instanceof File ? Buffer.from(await value.arrayBuffer()) : null);

export async function POST(request: Request) {
  const admin = await adminCollector(request);
  if (admin.response) return admin.response;
  const { user } = admin;
  try {
    const key = `car-setup-files:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.carSetupFilesPerHour)) return NextResponse.json({ error: 'Too many setup uploads; try again later' }, { status: 429 });
    recordAttempt(key);
    const form = await readFormDataLimited(request, CAR_SETUP_LIMITS.stoBytes + CAR_SETUP_LIMITS.htmBytes + 16 * 1024).catch((error) =>
      error instanceof BodyTooLargeError ? ('tooLarge' as const) : null
    );
    if (form === 'tooLarge') return NextResponse.json({ error: 'The setup files are too large', code: 'tooLarge' }, { status: 413 });
    const metaText = form?.get('meta');
    let metaJson: unknown = null;
    try {
      metaJson = typeof metaText === 'string' ? JSON.parse(metaText) : null;
    } catch {
      metaJson = null;
    }
    const meta = metaSchema.safeParse(metaJson);
    const sto = await fileBytes(form?.get('sto') ?? null);
    if (!form || !meta.success || !sto) return NextResponse.json({ error: 'Invalid setup upload', code: 'badRequest' }, { status: 400 });
    const htm = await fileBytes(form.get('htm'));
    const { importId, ...listed } = meta.data;
    const result = await storeSetup(
      user.id,
      importId,
      { ...listed, htmFileName: listed.htmFileName ?? null, htmSha256: listed.htmSha256 ?? null, htmBytes: listed.htmBytes ?? null },
      sto,
      htm
    );
    return NextResponse.json(result, { status: result.decision === 'new' ? 201 : 200 });
  } catch (error) {
    return carSetupErrorResponse(error, 'Car setup upload');
  }
}
