import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { isUuid, MEMORY_MODES, type MemoryMode } from '@/lib/memory/rules';
import { updateNamespace } from '@/lib/memory/store';
import { bool, str } from '@/lib/memory/validate';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request, 8 * 1024);
  if (b.mode !== undefined && b.mode !== null && !(MEMORY_MODES as readonly unknown[]).includes(b.mode)) throw new ApiError(400, 'invalid', 'Unknown mode');
  await updateNamespace(
    id,
    {
      name: str(b.name, 100, 'name'),
      description: str(b.description, 500, 'description'),
      enabled: bool(b.enabled, 'enabled'),
      mode: b.mode === undefined ? undefined : ((b.mode as MemoryMode | null) ?? null),
      isCustomerData: bool(b.isCustomerData, 'isCustomerData'),
      globalApproved: bool(b.globalApproved, 'globalApproved'),
    },
    caller.actor
  );
  return { ok: true };
});
