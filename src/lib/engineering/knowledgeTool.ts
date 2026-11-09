import { tool } from 'langchain';
import { z } from 'zod';
import { engineeringContext } from './knowledgeService';

// The get_engineering_knowledge tool: the Race Engineering knowledge base (knowledgeService.ts) for the agents that
// coach from lap data: the Debrief Coach, the In-Car AI Coach's lap callouts and the Race Engineer. It answers
// engineering principles, the diagnosis they give for a handling symptom, and what this car class can adjust. Each
// agent's prompt says when to use it; the tool itself never fails an answer (an error says the knowledge isn't
// available). The Setup Engineer gets the same knowledge in its prompt instead (src/lib/setupEngineer.ts).
export function engineeringKnowledgeTool(car: string, options: { maxTokens?: number; fixed?: boolean; setupKnown?: boolean } = {}) {
  return tool(
    async ({ question }: { question: string }) => {
      try {
        const context = await engineeringContext({
          question,
          car,
          fixed: options.fixed ?? false,
          setupKnown: options.setupKnown ?? false,
          rotation: null,
          maxTokens: options.maxTokens ?? 900,
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
        'on exit", "unstable under braking") for this car: likely causes, telemetry indicators, driving corrections ' +
        'and the setup options this car class has. It knows nothing about this session\'s laps.',
      schema: z.object({ question: z.string().max(300).describe('The handling symptom and corner phase, in English') }),
    }
  );
}
