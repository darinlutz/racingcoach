import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ABUSE_LIMITS, limitReached, recordAttempt } from '@/lib/abuseGuards';
import { cleanListedSetup, planImport, type ListedSetup } from '@/lib/carSetupLibrary';
import { CAR_SETUP_LIMITS, cleanCarFolder } from '@/lib/carSetupLibraryRules';
import { adminCollector, carSetupErrorResponse } from '@/lib/carSetupRoutes';
import { readJsonLimited } from '@/lib/requestBody';

// Get Car Setups, step 1 (the collector's SetupLibraryScanner.cs; docs/setups.md's iRacing setup collection): every
// setup found in the setups folder, with its files' names, sizes and SHA-256 hashes, and the files it couldn't read.
// Answers the import's ID, whether each car folder is a Car Data car, and what each setup is: new, changed,
// unchanged (its files aren't sent again) or unresolvedCar (not imported). Admins only (upload key auth).

const setupSchema = z.object({
  path: z.string().min(1).max(CAR_SETUP_LIMITS.pathChars),
  stoFileName: z.string().min(1).max(200),
  stoSha256: z.string().regex(/^[0-9a-f]{64}$/),
  stoBytes: z.number().int().positive(),
  htmFileName: z.string().min(1).max(200).nullish(),
  htmSha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  htmBytes: z.number().int().positive().nullish(),
});

const planSchema = z.object({
  simulator: z.literal('iracing').default('iracing'),
  collectorVersion: z.string().max(40).nullish(),
  cars: z.array(z.object({ folder: z.string().min(1).max(80), setups: z.array(setupSchema).max(CAR_SETUP_LIMITS.setupsPerImport) })).max(500),
  unreadable: z.array(z.object({ path: z.string().max(400), error: z.string().max(400) })).max(CAR_SETUP_LIMITS.errorsPerImport).default([]),
});

export async function POST(request: Request) {
  const admin = await adminCollector(request);
  if (admin.response) return admin.response;
  const { user } = admin;
  try {
    const key = `car-setup-imports:${user.id}`;
    if (limitReached(key, ABUSE_LIMITS.carSetupImportsPerHour)) return NextResponse.json({ error: 'Too many imports; try again later' }, { status: 429 });
    recordAttempt(key);
    const parsed = planSchema.safeParse(await readJsonLimited(request, 1024 * 1024).catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid setup list', code: 'badRequest' }, { status: 400 });
    const cars: { folder: string; setups: ListedSetup[] }[] = [];
    let total = 0;
    for (const car of parsed.data.cars) {
      const folder = cleanCarFolder(car.folder);
      if (!folder) return NextResponse.json({ error: `Invalid car folder name: ${car.folder.slice(0, 80)}`, code: 'badRequest' }, { status: 400 });
      const setups: ListedSetup[] = [];
      for (const listed of car.setups) {
        const setup = cleanListedSetup({
          ...listed,
          htmFileName: listed.htmFileName ?? null,
          htmSha256: listed.htmSha256 ?? null,
          htmBytes: listed.htmBytes ?? null,
        });
        if (!setup) return NextResponse.json({ error: `Invalid setup: ${folder}/${listed.path.slice(0, 120)}`, code: 'badRequest' }, { status: 400 });
        setups.push(setup);
      }
      total += setups.length;
      cars.push({ folder, setups });
    }
    if (total > CAR_SETUP_LIMITS.setupsPerImport) return NextResponse.json({ error: 'Too many setups in one import', code: 'badRequest' }, { status: 413 });
    const plan = await planImport(user.id, { collectorVersion: parsed.data.collectorVersion ?? null, cars, unreadable: parsed.data.unreadable });
    return NextResponse.json(plan);
  } catch (error) {
    return carSetupErrorResponse(error, 'Car setup import plan');
  }
}
