import { NextResponse } from 'next/server';
import { carModelErrorResponse, carModelsAdmin, glbProblemText, modelProblemText } from '@/lib/carModels/carModelRoutes';
import { carModelStorageConfigured } from '@/lib/carModels/carModelStorage';
import { createCarModel, listCarModels, listModelCars } from '@/lib/carModels/carModelStore';
import { checkGlb, GLB_LIMITS } from '@/lib/carModels/glb';
import { MODEL_LIMITS, parseCarKeys, parseModelSettings } from '@/lib/carModels/modelRules';
import { parseSharedCarIds } from '@/lib/carViews/assetRules';
import { readFormDataLimited } from '@/lib/requestBody';
import { listSetupFolders } from '@/lib/setupFolders';

// The Admin page's 3D Car Models (docs/car-models.md). GET answers { cars, models, storageConfigured }: every Car Data
// car (with its size, to check a model's scale against) and every model version with its settings and history. POST
// (multipart: carId, sharedCarIds (the other cars that use it, comma separated), carKeys, source, license, attribution, notes, file) uploads a new version: the GLB is checked
// whole (glb.ts) before anything is stored, then kept in object storage and its row added as Uploaded. Admin role only;
// anyone else 404.
export async function GET() {
  const session = await carModelsAdmin();
  if (session.response) return session.response;
  try {
    // setupFolders: the iRacing setup folders collectors have reported (setupFolders.ts), offered as car paths
    const [cars, models, setupFolders] = await Promise.all([
      listModelCars(),
      listCarModels(),
      listSetupFolders().catch((error) => {
        console.error('Setup folders list error:', error);
        return [] as string[];
      }),
    ]);
    return NextResponse.json({ cars, models, setupFolders, storageConfigured: carModelStorageConfigured(), limits: { bytes: GLB_LIMITS.bytes } });
  } catch (error) {
    return carModelErrorResponse(error, session.t, 'Car models list');
  }
}

export async function POST(request: Request) {
  const session = await carModelsAdmin();
  if (session.response) return session.response;
  const { t } = session;
  if (!carModelStorageConfigured()) return NextResponse.json({ error: t.errors.storageMissing, code: 'storageMissing' }, { status: 503 });
  const form = await readFormDataLimited(request, GLB_LIMITS.bytes + 64 * 1024).catch(() => null);
  if (!form) return NextResponse.json({ error: t.problems.glb.tooLarge }, { status: 413 });
  const file = form.get('file');
  const carId = Number(form.get('carId'));
  const problems: string[] = [];
  if (!Number.isInteger(carId) || carId <= 0) problems.push(t.problems.car);
  const sharedCarIds = parseSharedCarIds(String(form.get('sharedCarIds') ?? ''), carId);
  if (!sharedCarIds) problems.push(t.problems.sharedCars);
  const keys = parseCarKeys(String(form.get('carKeys') ?? ''));
  problems.push(...keys.problems.map((p) => modelProblemText(p, t)));
  const settings = parseModelSettings({
    source: String(form.get('source') ?? ''),
    license: String(form.get('license') ?? ''),
    attribution: String(form.get('attribution') ?? ''),
    notes: String(form.get('notes') ?? ''),
  });
  if (!settings.ok) problems.push(...settings.problems.map((p) => modelProblemText(p, t)));
  if (!(file instanceof File) || file.size === 0) problems.push(t.problems.file);
  if (problems.length || !(file instanceof File) || !settings.ok || !sharedCarIds) return NextResponse.json({ error: t.errors.invalid, problems }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = checkGlb(bytes);
  if (!check.ok) return NextResponse.json({ error: t.errors.invalid, problems: check.problems.map((p) => glbProblemText(p, t)) }, { status: 400 });
  try {
    const created = await createCarModel(
      {
        carId,
        sharedCarIds,
        carKeys: keys.keys,
        fileName: file.name.slice(0, MODEL_LIMITS.fileName),
        bytes,
        info: check.info,
        source: settings.settings.source ?? '',
        license: settings.settings.license ?? '',
        attribution: settings.settings.attribution ?? '',
        notes: settings.settings.notes ?? '',
      },
      session.user.id
    );
    console.log(`Car model ${created.id} (car ${carId} v${created.version}, ${bytes.length} bytes, ${check.info.stats.triangles} triangles) uploaded by user ${session.user.id}`);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return carModelErrorResponse(error, t, 'Car model upload');
  }
}
