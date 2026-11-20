import { NextResponse } from 'next/server';
import { z } from 'zod';
import { finishImport } from '@/lib/carSetupLibrary';
import { CAR_SETUP_LIMITS } from '@/lib/carSetupLibraryRules';
import { adminCollector, carSetupErrorResponse } from '@/lib/carSetupRoutes';
import { readJsonLimited } from '@/lib/requestBody';

// Get Car Setups, step 3: the import is over, with the setups that failed (the server's refusals and anything the
// collector couldn't send), recorded with it for the Setups page's iRacing Setups tab. Answers the import's counts.
// Admins only (upload key auth).

const finishSchema = z.object({
  importId: z.number().int().positive(),
  failures: z.array(z.object({ path: z.string().max(400), error: z.string().max(400) })).max(CAR_SETUP_LIMITS.setupsPerImport).default([]),
});

export async function POST(request: Request) {
  const admin = await adminCollector(request);
  if (admin.response) return admin.response;
  try {
    const parsed = finishSchema.safeParse(await readJsonLimited(request, 512 * 1024).catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid import result', code: 'badRequest' }, { status: 400 });
    return NextResponse.json(await finishImport(admin.user.id, parsed.data.importId, parsed.data.failures));
  } catch (error) {
    return carSetupErrorResponse(error, 'Car setup import finish');
  }
}
