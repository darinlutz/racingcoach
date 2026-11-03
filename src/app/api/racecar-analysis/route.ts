import { readCars } from '@/lib/carData';
import { createRagRoute } from '@/lib/ragRoute';
import { readTracksForAnalysis } from '@/lib/trackAnalysis';

// Longer limit: the prompt carries every car and track row, which the local
// Ollama model needs several minutes to process on a CPU. Silver and Gold only. The cloud option uses the model picked
// for Racecar Analysis in the Admin page's AI Model Control. The cars are Car Data's (racingcoach."Cars") and the
// tracks Track Data's (trackAnalysis.ts), so changes in the Cars tab and Track and Focus Area Maintenance are in the
// next answer.
export const { GET, POST } = createRagRoute('racecar_analysis_rag.py', 'racecarAnalysis', 360000, {
  notForBronze: true,
  modelFeature: 'racecarAnalysis',
  payload: async () => {
    const [cars, tracks] = await Promise.all([readCars(), readTracksForAnalysis()]);
    return { cars, tracks };
  },
});
