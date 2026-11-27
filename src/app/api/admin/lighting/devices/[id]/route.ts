import { NextResponse } from 'next/server';
import { forgetAgentStatus } from '@/lib/lighting/agentStatus';
import { revokeLightingDevice } from '@/lib/lighting/devices';
import { lightingAdmin, lightingError } from '@/lib/lighting/routeHelpers';

type Params = { params: Promise<{ id: string }> };

// Revokes one of the account's lighting agents (Lighting Control's Remove): its tokens end at once, and its event
// stream says reauth within 30 s. Admins only; anyone else 404.
export async function DELETE(_request: Request, { params }: Params) {
  const admin = await lightingAdmin();
  if (admin.response) return admin.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return lightingError('notFound', 404);
  try {
    if (!(await revokeLightingDevice(id, admin.user.id))) return lightingError('notFound', 404);
    forgetAgentStatus(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Lighting device revoke error:', error);
    return lightingError('failed', 500);
  }
}
