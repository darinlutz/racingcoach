import { NextResponse } from 'next/server';
import { readCarSetup, setCarSetupProvenance } from '@/lib/carSetupLibrary';
import { adminSession } from '@/lib/carSetupRoutes';
import { readJsonLimited } from '@/lib/requestBody';
import { idOf } from '@/lib/setupRoutes';

// One imported iRacing setup: its files' details and the values read from its .htm export (GET), or where it came
// from, as an Admin has checked it (PATCH { provenance: 'official' | 'user' | 'unknown' }). Admins only, 404 otherwise.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminSession();
  if (admin.response) return admin.response;
  const id = idOf((await params).id);
  try {
    const setup = id ? await readCarSetup(id) : null;
    if (!setup) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ setup });
  } catch (error) {
    console.error('Car setup read error:', error);
    return NextResponse.json({ error: 'Failed to load the setup' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminSession();
  if (admin.response) return admin.response;
  const id = idOf((await params).id);
  try {
    const body = await readJsonLimited(request, 1024).catch(() => null);
    if (!id || !(await setCarSetupProvenance(id, body?.provenance))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Car setup provenance error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
