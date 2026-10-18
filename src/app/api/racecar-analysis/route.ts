import { createRagRoute } from '@/lib/ragRoute';

// Longer limit: the prompt carries every car and track row, which the local
// Ollama model needs several minutes to process on a CPU. Silver and Gold only.
export const { GET, POST } = createRagRoute('racecar_analysis_rag.py', 'racecarAnalysis', 360000, { notForBronze: true });
