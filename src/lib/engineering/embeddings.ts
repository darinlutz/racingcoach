import { OpenAIEmbeddings } from '@langchain/openai';
import { assertMeteredServicesOn } from '@/lib/meteredServices';

// Embeddings for the Race Engineering knowledge base, through OpenAI (the provider the Racecar Analysis RAG already
// uses). The model is configurable: ENGINEERING_EMBEDDING_MODEL, else DEFAULT_EMBEDDING_MODEL, which
// `npm run engineering:knowledge -- benchmark` compared with keyword-only retrieval (docs/race-engineering-rag.md).
// A query is always embedded with the model its chunks were embedded with (knowledgeStore.readEmbeddingModel), so
// changing the model needs a reindex. Refused while the Admin page's emergency stop is on, like every paid call.

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_MODELS = ['text-embedding-3-small', 'text-embedding-3-large'] as const;
// US$ per million input tokens, for the ingestion jobs' cost estimates
export const EMBEDDING_PRICE_PER_MILLION: Record<string, number> = { 'text-embedding-3-small': 0.02, 'text-embedding-3-large': 0.13 };

export function configuredEmbeddingModel(): string {
  const model = process.env.ENGINEERING_EMBEDDING_MODEL?.trim();
  return model && (EMBEDDING_MODELS as readonly string[]).includes(model) ? model : DEFAULT_EMBEDDING_MODEL;
}

const BATCH = 64;

// skipServiceCheck is only for the command line's in-memory benchmark, run by a person, which has no database to read
// the emergency stop from
export async function embedTexts(texts: string[], model = configuredEmbeddingModel(), skipServiceCheck = false): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!skipServiceCheck) await assertMeteredServicesOn();
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const client = new OpenAIEmbeddings({ model, maxRetries: 2, timeout: 20_000, batchSize: BATCH });
  return client.embedDocuments(texts.map((t) => t.slice(0, 8000)));
}
