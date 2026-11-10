// What the agents took from the Race Engineering knowledge base lately, for the Admin page's Race Engineering
// Knowledge section: which agent asked, with which model configured for its feature, the weather it saw, what it
// asked and which documents came back. Server memory only (the last MAX_ENTRIES, lost on a restart), no user, no
// answer text: enough to see that the agents really use the wet-weather knowledge, nothing to keep.

export type KnowledgeUse = {
  at: number;
  agent: 'setupEngineer' | 'raceEngineer' | 'debriefCoach' | 'inCarCoachCallouts' | 'adminTest' | 'other';
  // The AI model configured for the agent's feature when it asked (aiModels.ts's getAiModel), when known
  model: string | null;
  car: string | null;
  // weatherContext.ts's weatherSummary
  weather: string;
  question: string;
  confidence: string;
  documents: string[];
  source: 'database' | 'starter';
};

const MAX_ENTRIES = 100;
const store = globalThis as typeof globalThis & { engineeringKnowledgeUses?: KnowledgeUse[] };

export function recordKnowledgeUse(use: KnowledgeUse): void {
  const list = (store.engineeringKnowledgeUses ??= []);
  list.push({ ...use, question: use.question.slice(0, 200) });
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
}

// Newest first
export function readKnowledgeUses(): KnowledgeUse[] {
  return [...(store.engineeringKnowledgeUses ?? [])].reverse();
}
