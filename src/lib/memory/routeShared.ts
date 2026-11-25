import { ApiError, namespacesFor, ownSpacePath, type MemoryCaller } from './api';
import { getConfig, getMemory, listCategories, type MemoryRecord } from './store';

// Lookups the Memory API's routes share: a memory the caller may see (404 otherwise, so another namespace's memory
// isn't even confirmed to exist), and a category by ID or key

export async function memoryFor(caller: MemoryCaller, id: string): Promise<MemoryRecord> {
  const config = await getConfig();
  const m = await getMemory(id, config.providers.embeddingModel);
  if (!m) throw new ApiError(404, 'notFound');
  try {
    await namespacesFor(caller, [m.namespaceId], { includeChildren: false, includeGlobal: false });
  } catch {
    throw new ApiError(404, 'notFound');
  }
  return m;
}

export async function categoryId(ref: unknown, fallbackKey = 'semantic'): Promise<string> {
  const categories = await listCategories();
  const c = categories.find((x) => x.id === ref || x.key === ref) ?? (ref === undefined || ref === null || ref === '' ? categories.find((x) => x.key === fallbackKey) : undefined);
  if (!c) throw new ApiError(400, 'invalid', 'Unknown category');
  return c.id;
}

// The one namespace a write goes to: named (ID or path) and authorized, else the default namespace
export async function writeNamespace(caller: MemoryCaller, ref: unknown): Promise<string> {
  const config = await getConfig();
  const name = typeof ref === 'string' && ref ? ref : (ownSpacePath(caller) ?? config.system.defaultNamespace);
  const [ns] = await namespacesFor(caller, [name], { includeChildren: false, includeGlobal: false });
  if (!ns) throw new ApiError(403, 'namespaceNotAllowed');
  return ns.id;
}
