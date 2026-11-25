import { assertMeteredServicesOn } from '@/lib/meteredServices';
import { ollamaEmbed, OfflineError } from './localServices';
import type { ProviderSettings } from './rules';

// Memory embeddings (docs/AI_MEMORY_ARCHITECTURE.md, Embeddings). Local first: Ollama on the Mac. OpenAI's
// text-embedding-3-small only when the settings send private content to an external provider
// (allowExternalPrivateContent, off by default), since a memory's text would leave the site. An embedding is only
// ever compared with embeddings of the same model, size and version: nothing substitutes one model for another.

export const EMBEDDING_VERSION = 'v1';

export type EmbeddingSpec = { provider: 'ollama' | 'openai'; model: string };
export type EmbedResult = { vectors: number[][]; dimensions: number; ms: number; spec: EmbeddingSpec };

export class EmbeddingPolicyError extends Error {}

// What's embedded for a memory: its title and text, so a short title still finds the memory
export const embeddingText = (m: { title: string; content: string }) => (m.title && !m.content.startsWith(m.title) ? `${m.title}\n${m.content}` : m.content);

export function activeSpec(p: ProviderSettings): EmbeddingSpec {
  return { provider: p.embeddingProvider, model: p.embeddingModel };
}

const globalForTests = globalThis as unknown as { memoryEmbedderForTests?: (spec: EmbeddingSpec, texts: string[]) => Promise<number[][]> };

// Tests replace the embedder (no Ollama in CI)
export function setEmbedderForTests(fn: ((spec: EmbeddingSpec, texts: string[]) => Promise<number[][]>) | null) {
  globalForTests.memoryEmbedderForTests = fn ?? undefined;
}

export async function embedTexts(spec: EmbeddingSpec, texts: string[], p: Pick<ProviderSettings, 'allowExternalPrivateContent'>): Promise<EmbedResult> {
  const started = Date.now();
  if (globalForTests.memoryEmbedderForTests) {
    const vectors = await globalForTests.memoryEmbedderForTests(spec, texts);
    return { vectors, dimensions: vectors[0]?.length ?? 0, ms: Date.now() - started, spec };
  }
  if (spec.provider === 'ollama') {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const r = await ollamaEmbed(spec.model, texts.slice(i, i + 32));
      vectors.push(...r.embeddings);
    }
    return { vectors, dimensions: vectors[0]?.length ?? 0, ms: Date.now() - started, spec };
  }
  if (!p.allowExternalPrivateContent) throw new EmbeddingPolicyError('External embedding providers are not allowed for private memory content');
  await assertMeteredServicesOn();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OfflineError('ollama', 'noOpenAiKey', 'OPENAI_API_KEY is not configured');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: spec.model, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenAI embeddings answered HTTP ${response.status}`);
  const body = (await response.json()) as { data: { embedding: number[]; index: number }[] };
  const vectors = body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  return { vectors, dimensions: vectors[0]?.length ?? 0, ms: Date.now() - started, spec };
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// pgvector's text form of a vector, for a query parameter cast to vector(n)
export const vectorLiteral = (v: readonly number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
