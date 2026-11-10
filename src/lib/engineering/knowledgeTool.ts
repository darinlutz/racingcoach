import { tool } from 'langchain';
import { z } from 'zod';
import { getAiModel } from '@/lib/aiModels';
import { engineeringContext } from './knowledgeService';
import type { KnowledgeUse } from './knowledgeUsage';
import type { WeatherContext } from './weatherContext';

// The get_engineering_knowledge tool: the Race Engineering knowledge base (knowledgeService.ts) for the agents that
// coach from lap data: the Debrief Coach, the In-Car AI Coach's lap callouts and the Race Engineer. It answers
// engineering principles, the diagnosis they give for a handling symptom, and what this car class can adjust, for
// the track conditions and tires when the agent knows them (weatherContext.ts: on a wet track the wet-weather
// knowledge comes first). Each agent's prompt says when to use it; the tool itself never fails an answer (an error
// says the knowledge isn't available). The Setup Engineer gets the same knowledge in its prompt instead
// (src/lib/setupEngineer.ts).
export function engineeringKnowledgeTool(
  car: string,
  options: {
    maxTokens?: number;
    fixed?: boolean;
    setupKnown?: boolean;
    weather?: WeatherContext | null;
    agent?: Exclude<KnowledgeUse['agent'], 'adminTest' | 'other'>;
    units?: 'metric' | 'standard';
  } = {}
) {
  return tool(
    async ({ question }: { question: string }) => {
      try {
        const model = options.agent ? await getAiModel(options.agent).catch(() => null) : null;
        const context = await engineeringContext({
          question,
          car,
          fixed: options.fixed ?? false,
          setupKnown: options.setupKnown ?? false,
          rotation: null,
          maxTokens: options.maxTokens ?? 900,
          ...(options.weather !== undefined ? { weather: options.weather } : {}),
          agent: options.agent,
          model,
          units: options.units,
        });
        return context.facts.join('\n');
      } catch (error) {
        console.error('Engineering knowledge tool failed:', error);
        return 'The engineering knowledge base is not available right now; answer from the lap data alone.';
      }
    },
    {
      name: 'get_engineering_knowledge',
      description:
        'Looks up vehicle dynamics and setup knowledge for a handling symptom (e.g. "understeer on entry", "wheelspin ' +
        'on exit", "unstable under braking", "aquaplaning", "wet tires overheating") for this car and the track ' +
        'conditions: likely causes, telemetry indicators, driving corrections and the setup options this car class ' +
        'has. It knows the track conditions and fitted tires when they were reported, but nothing about this ' +
        'session\'s laps.',
      schema: z.object({ question: z.string().max(300).describe('The handling symptom and corner phase, in English') }),
    }
  );
}
