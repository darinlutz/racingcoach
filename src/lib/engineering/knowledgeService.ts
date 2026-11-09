import { capabilitiesFor, allowedParameters, capabilityFacts, type CarCapabilities, type SetupCapability } from './setupCapabilities';
import { diagnose, diagnosisFacts, type Diagnosis, type RotationEvidence } from './diagnosis';
import { assembleContext, recordToChunk, retrieve, type AssembledContext, type KnowledgeChunk, type Retrieval } from './retrieval';
import { STARTER_CORPUS } from './starterCorpus';
import type { ParameterId, SimulatorId } from './knowledgeTypes';
import type { SessionRotation } from '@/lib/rotationAnalysis';

// The Race Engineering knowledge service shared by the Setup Engineer (src/lib/setupEngineer.ts) and the Race Coach
// (the Debrief Coach's get_engineering_knowledge tool, src/lib/debriefCoach.ts): loads the knowledge chunks (the
// database's active ones, knowledgeStore.ts, else the starter corpus in code), the car's setup capabilities, embeds
// the question when the chunks have embeddings, retrieves, diagnoses and packs it all into prompt facts. Everything
// is cached in memory for CACHE_MS, so a radio call costs no database round trip after the first. A failure anywhere
// falls back to the starter corpus, or to nothing, never failing the agent's answer. docs/race-engineering-rag.md.

const CACHE_MS = 5 * 60_000;

type Loaded = {
  chunks: KnowledgeChunk[];
  capabilityOverrides: { simulator: SimulatorId; car: string; capabilities: SetupCapability[] }[];
  source: 'database' | 'starter';
  embeddingModel: string | null;
};

const globalCache = globalThis as typeof globalThis & { engineeringKnowledge?: { at: number; loaded: Promise<Loaded> } };

const STARTER: Loaded = { chunks: STARTER_CORPUS.map(recordToChunk), capabilityOverrides: [], source: 'starter', embeddingModel: null };

async function loadFresh(): Promise<Loaded> {
  try {
    // Imported here so the pure modules (and their tests) never load the database
    const store = await import('./knowledgeStore');
    const [chunks, overrides, model] = await Promise.all([
      store.readActiveChunks(),
      store.readCapabilityOverrides(),
      store.readEmbeddingModel(),
    ]);
    if (chunks.length === 0) return { ...STARTER, capabilityOverrides: overrides };
    return { chunks, capabilityOverrides: overrides, source: 'database', embeddingModel: model };
  } catch (error) {
    console.warn('Engineering knowledge: using the starter corpus, as the database could not be read:', error instanceof Error ? error.message : error);
    return STARTER;
  }
}

export function loadKnowledge(): Promise<Loaded> {
  const cached = globalCache.engineeringKnowledge;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.loaded;
  const loaded = loadFresh();
  globalCache.engineeringKnowledge = { at: Date.now(), loaded };
  return loaded;
}

// After ingestion or an Admin change, so the next question sees it
export function invalidateKnowledgeCache(): void {
  globalCache.engineeringKnowledge = undefined;
}

// The Rotation Model's session summary as the diagnosis wants it
export function rotationEvidence(rotation: SessionRotation | null): RotationEvidence | null {
  if (!rotation) return null;
  const s = rotation.summary;
  return {
    usableLaps: rotation.laps.filter((lap) => lap.supported).length,
    understeerEvents: s.understeerEvents,
    oversteerEvents: s.oversteerEvents,
    byPhase: s.byPhase,
    oversteerTypes: s.oversteerTypes,
    onBrake: s.onBrake,
    onThrottle: s.onThrottle,
    recurring: rotation.recurring.map((r) => ({ eventType: r.eventType, cornerPhase: r.cornerPhase, laps: r.laps })),
  };
}

export type EngineeringContext = {
  capabilities: CarCapabilities;
  allowed: Set<ParameterId>;
  retrieval: Retrieval;
  diagnosis: Diagnosis;
  context: AssembledContext;
  // Everything for the prompt, as lines
  facts: string[];
  source: Loaded['source'];
};

export async function engineeringContext(input: {
  question: string;
  car: string | null;
  simulator?: SimulatorId;
  fixed: boolean;
  setupKnown: boolean;
  rotation: RotationEvidence | null;
  coldTires?: boolean;
  maxTokens?: number;
  // Leave out the diagnosis (the Race Coach asks about principles, not always a symptom)
  withDiagnosis?: boolean;
}): Promise<EngineeringContext> {
  const simulator = input.simulator ?? 'iracing';
  const loaded = await loadKnowledge();
  const capabilities = capabilitiesFor(
    simulator,
    input.car,
    loaded.capabilityOverrides.filter((o) => o.simulator === simulator)
  );
  const allowed = allowedParameters(capabilities, input.fixed);
  const ctx = { simulator, carClass: capabilities.carClass, car: input.car, allowed: capabilities.known ? allowed : null };
  const queryEmbedding = loaded.embeddingModel ? await embedQuery(input.question, loaded.embeddingModel) : null;
  const retrieval = retrieve(loaded.chunks, input.question, ctx, { queryEmbedding });
  const diagnosis = diagnose({
    said: input.question,
    retrieval,
    capabilities,
    allowed,
    fixed: input.fixed,
    setupKnown: input.setupKnown,
    rotation: input.rotation,
    coldTires: input.coldTires,
  });
  const context = assembleContext(retrieval, ctx, input.maxTokens ?? 1200);
  const facts = [
    `Car class: ${capabilities.carClass}; simulator: ${simulator}.`,
    ...capabilityFacts(capabilities, input.fixed),
    ...(input.withDiagnosis === false ? [] : ['', ...diagnosisFacts(diagnosis)]),
    ...(context.text ? ['', context.text] : []),
  ];
  return { capabilities, allowed, retrieval, diagnosis, context, facts, source: loaded.source };
}

// The question's embedding with the model the chunks were embedded with; null on any failure, so retrieval goes on
// with keywords and metadata alone
async function embedQuery(question: string, model: string): Promise<number[] | null> {
  try {
    const { embedTexts } = await import('./embeddings');
    const [vector] = await embedTexts([question.slice(0, 2000)], model);
    return vector ?? null;
  } catch (error) {
    console.warn('Engineering knowledge: query embedding failed, using keywords only:', error instanceof Error ? error.message : error);
    return null;
  }
}
