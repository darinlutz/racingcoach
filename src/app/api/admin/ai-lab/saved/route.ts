import { NextResponse } from 'next/server';
import { bad, labAdmin, labBody, throttled, unavailable } from '@/lib/aiLab/routeHelpers';
import { cleanParams, LAB_PARAMS, LAB_TEXT_LIMITS, validModelName } from '@/lib/aiLab/rules';
import { deleteBenchmark, deletePrompt, listBenchmarks, listPrompts, saveBenchmark, savePrompt, type BenchmarkResult } from '@/lib/aiLab/store';

// The playground's saved prompts and benchmark results (docs/AI_LAB_SETUP.md). GET both; POST { kind: 'prompt' |
// 'benchmark', ... }; DELETE ?kind=&id=. Admin role only (404).

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export async function GET() {
  const { denied } = await labAdmin();
  if (denied) return denied;
  try {
    const [prompts, benchmarks] = await Promise.all([listPrompts(), listBenchmarks()]);
    return NextResponse.json({ prompts, benchmarks });
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request) {
  const { user, denied } = await labAdmin();
  if (denied) return denied;
  const body = await labBody(request);
  if (body instanceof NextResponse) return body;
  if (throttled(user.id, 'saved', 30)) return bad('tooMany', 429);
  const name = text(body.name, LAB_TEXT_LIMITS.name);
  const prompt = text(body.prompt, LAB_TEXT_LIMITS.prompt);
  const system = text(body.system, LAB_TEXT_LIMITS.system);
  if (!name || !prompt) return bad('badName');
  try {
    if (body.kind === 'prompt') {
      const models = (Array.isArray(body.models) ? body.models : []).filter((m): m is string => typeof m === 'string' && m.length <= 220).slice(0, 6);
      const id = await savePrompt({ id: Number(body.id) || null, name, prompt, system, params: cleanParams(body.params, LAB_PARAMS), models });
      return NextResponse.json({ id });
    }
    if (body.kind === 'benchmark') {
      const raw = Array.isArray(body.results) ? body.results.slice(0, 6) : [];
      const results: BenchmarkResult[] = raw.map((r: Record<string, unknown>) => ({
        model: validModelName(r.model) ? r.model : 'unknown',
        provider: text(r.provider, 20),
        text: text(r.text, 40_000),
        error: r.error ? text(r.error, 300) : null,
        metrics: r.metrics && typeof r.metrics === 'object' ? (r.metrics as Record<string, unknown>) : null,
      }));
      if (!results.length) return bad('noResults');
      const id = await saveBenchmark({ name, prompt, system, results });
      return NextResponse.json({ id });
    }
    return bad('unknownKind');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Too many')) return bad('tooManySaved', 409);
    return unavailable(error);
  }
}

export async function DELETE(request: Request) {
  const { denied } = await labAdmin();
  if (denied) return denied;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return bad('badId');
  try {
    if (url.searchParams.get('kind') === 'prompt') await deletePrompt(id);
    else if (url.searchParams.get('kind') === 'benchmark') await deleteBenchmark(id);
    else return bad('unknownKind');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return unavailable(error);
  }
}
