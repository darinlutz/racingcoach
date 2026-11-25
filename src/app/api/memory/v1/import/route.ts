import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { previewImport, readOpenWebuiMemories, runImportJob, type CommitRow } from '@/lib/memory/importExport';
import { kickJobs } from '@/lib/memory/jobs';
import { IMPORT_FORMATS, MAX_IMPORT_ROWS, type ImportFormat } from '@/lib/memory/portable';
import { isUuid } from '@/lib/memory/rules';
import { enqueueJob } from '@/lib/memory/store';
import { str } from '@/lib/memory/validate';

// Import: { action: 'preview', format, text | source: 'openWebui', mapping } is a dry run that changes nothing;
// { action: 'commit', rows, source } imports the rows the Admin picked (a job for over 100 rows)
export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 20 }, async (request, caller) => {
  const b = await body(request, 4 * 1024 * 1024);
  const allowed = new Set((await namespacesFor(caller, null)).map((n) => n.id));
  if (b.action === 'preview') {
    const mapping = (b.mapping ?? {}) as { defaultNamespaceId?: string; defaultCategoryId?: string };
    if (!isUuid(mapping.defaultNamespaceId) || !allowed.has(mapping.defaultNamespaceId) || !isUuid(mapping.defaultCategoryId)) throw new ApiError(400, 'invalid', 'A default namespace and category are required');
    let format = b.format as ImportFormat;
    let text = str(b.text, 4 * 1024 * 1024, 'text') ?? '';
    if (b.source === 'openWebui') {
      format = 'openWebui';
      text = JSON.stringify(await readOpenWebuiMemories());
    }
    if (!(IMPORT_FORMATS as readonly string[]).includes(format)) throw new ApiError(400, 'invalid', 'Unknown format');
    const preview = await previewImport(format, text, mapping as { defaultNamespaceId: string; defaultCategoryId: string });
    return { ...preview, rows: preview.rows.map((r) => ({ ...r, namespaceAllowed: r.namespaceId ? allowed.has(r.namespaceId) : false })) };
  }
  if (b.action === 'commit') {
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, MAX_IMPORT_ROWS) as CommitRow[];
    for (const r of rows) if (!isUuid(r.namespaceId) || !allowed.has(r.namespaceId) || !isUuid(r.categoryId) || typeof r.content !== 'string') throw new ApiError(400, 'invalid', 'Every row needs an allowed namespace, a category and content');
    const source = b.source === 'openWebui' ? 'openWebui' : 'file';
    const importId = `${Date.now()}`;
    if (rows.length <= 100) {
      const r = await runImportJob({ rows, source, importId }, caller.user.id);
      kickJobs();
      return { ...r, job: null };
    }
    return { job: await enqueueJob(null, 'import', { rows, source, importId }, { userId: caller.user.id }) };
  }
  throw new ApiError(400, 'invalid', 'Unknown action');
});
