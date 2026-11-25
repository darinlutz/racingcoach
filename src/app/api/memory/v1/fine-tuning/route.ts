import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { buildTrainingDataset } from '@/lib/memory/importExport';
import { int, list, str } from '@/lib/memory/validate';

// Fine-tuning dataset preparation (no training): a preview, then a versioned JSONL export with provenance
export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 10 }, async (request, caller) => {
  const b = await body(request, 32 * 1024);
  const requested = list(b.namespaces, 'namespaces', 50);
  if (!requested?.length) throw new ApiError(400, 'invalid', 'Pick the namespaces to include');
  const allowed = await namespacesFor(caller, requested, { includeChildren: true, includeGlobal: false });
  const split = (b.split ?? {}) as Record<string, unknown>;
  return buildTrainingDataset(
    {
      namespaceIds: allowed.filter((n) => !n.isCustomerData).map((n) => n.id),
      categoryKeys: list(b.categories, 'categories', 20) ?? [],
      minImportance: int(b.minImportance, 1, 10, 'minImportance') ?? 5,
      split: { train: int(split.train, 0, 100, 'train') ?? 80, valid: int(split.valid, 0, 100, 'valid') ?? 10, test: int(split.test, 0, 100, 'test') ?? 10 },
      seed: str(b.seed, 40, 'seed') ?? 'clarivex',
      system: str(b.system, 2000, 'system') ?? 'You are a helpful assistant for the Clarivex team.',
      format: b.format === 'instruction' ? 'instruction' : 'chat',
      name: (str(b.name, 40, 'name') ?? 'memories').replace(/[^A-Za-z0-9-]/g, '-'),
      preview: b.preview !== false,
    },
    { ...caller.actor, userId: caller.user.id }
  );
});
