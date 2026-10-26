import { execFile } from 'node:child_process';
import path from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { NextResponse } from 'next/server';
import { MEMBERSHIP_LEVEL } from './accountStatus';
import { isAiOutOfCredits } from './aiErrors';
import { aiModelCategoryOf, chatModel, getAiModel, type AiFeature } from './aiModels';
import { withAiUsage } from './aiTokenUsage';
import { aiRateLimit, type RateLimitedFeature } from './rateLimits';
import { isAdmin } from './roles';
import { getCurrentUser } from './session';
import { getEnableAiFeatures, getShowPricing } from './siteSettings';
import { apiText } from './i18n/server';
import { getUnits } from './unitsServer';

const LLM_TYPES = ['openai', 'ollama'];
const EMBEDDING_TYPES = ['openai', 'chroma', 'nomic'];

export const isLlmType = (value: unknown): value is string => LLM_TYPES.includes(value as string);
export const isEmbeddingType = (value: unknown): value is string =>
  EMBEDDING_TYPES.includes(value as string);

// The Ollama LLM and Nomic embedding options talk to a local Ollama server,
// which doesn't exist on hosted deployments, so the UI asks whether one is
// reachable before offering them. extra is added to the answer.
export async function ollamaAvailabilityResponse(extra: Record<string, unknown> = {}) {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1500),
    });
    return NextResponse.json({ ...extra, ollamaAvailable: response.ok });
  } catch {
    return NextResponse.json({ ...extra, ollamaAvailable: false });
  }
}

// Runs a Python script in src/ with a JSON payload argument and resolves with
// the JSON object it prints. Rejects with the script's error message.
export function runPythonJson<T extends { error?: string }>(
  scriptFile: string,
  payload: unknown,
  timeoutMs = 60000
): Promise<T> {
  const scriptPath = path.join(process.cwd(), 'src', scriptFile);

  return new Promise<T>((resolve, reject) => {
    execFile(
      'python',
      [scriptPath, JSON.stringify(payload)],
      {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        let parsed: T | undefined;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          parsed = undefined;
        }

        if (parsed?.error) {
          reject(new Error(parsed.error));
          return;
        }

        if (error) {
          let message = stderr.trim() || error.message;
          try {
            message = JSON.parse(stderr.trim()).error || message;
          } catch {
            // stderr wasn't the script's JSON error; keep the raw text.
          }
          reject(new Error(message));
          return;
        }

        if (!parsed) {
          reject(new Error('Script returned no result'));
          return;
        }

        resolve(parsed);
      }
    );
  });
}

// Builds the GET/POST handlers for a RAG tab backed by a Python script in
// src/ that accepts a JSON payload argument and prints a JSON result. feature is
// what the Admin page's Rate Limiting counts its calls as. While the Admin page's Enable AI Features is off, every
// POST gets 403 { code: 'aiFeaturesDisabled' }. With notForBronze, signed-in Bronze members (other than
// Admins) get 403 { code: 'membershipRequired', showPricing } before any AI call, which opens the page's
// MembershipRequiredDialog. With modelFeature, the 'openai' LLM option asks the script for its prompt only
// ({ promptOnly: true } answers { system, prompt, references }) and sends it to that feature's model from the Admin
// page's AI Model Control (chatModel), whose tokens are added to the call's AiUsage row; GET also answers the
// caller's model as model. The Ollama option still runs entirely in the script.
export function createRagRoute(
  scriptFile: string,
  feature: RateLimitedFeature,
  timeoutMs = 60000,
  { notForBronze = false, modelFeature }: { notForBronze?: boolean; modelFeature?: AiFeature } = {}
) {
  async function GET() {
    if (!modelFeature) return ollamaAvailabilityResponse();
    const user = await getCurrentUser();
    const model = await withAiUsage(null, aiModelCategoryOf(user), () => getAiModel(modelFeature));
    return ollamaAvailabilityResponse({ model });
  }

  async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const llmType = isLlmType(body.llmType) ? body.llmType : 'openai';
    const embeddingType = isEmbeddingType(body.embeddingType) ? body.embeddingType : 'openai';

    const user = await getCurrentUser();
    if (!(await getEnableAiFeatures())) {
      return NextResponse.json({ error: 'AI features are turned off', code: 'aiFeaturesDisabled' }, { status: 403 });
    }
    if (notForBronze && user && user.membershipLevel === MEMBERSHIP_LEVEL.bronze && !isAdmin(user.role)) {
      return NextResponse.json(
        { error: 'Not available for Bronze members', code: 'membershipRequired', showPricing: await getShowPricing() },
        { status: 403 }
      );
    }
    const limit = await aiRateLimit(request, feature, user);
    if (limit.response) return limit.response;

    try {
      const promptOnly = Boolean(modelFeature) && llmType === 'openai';
      const result = await runPythonJson<{
        response?: string;
        system?: string;
        prompt?: string;
        references?: string[];
        error?: string;
      }>(
        scriptFile,
        // units: the user's Preferred Units, for scripts that show measurements (racecar_analysis_rag.py)
        { query, llmType, embeddingType, units: await getUnits(user), promptOnly },
        timeoutMs
      );

      if (promptOnly && modelFeature && result.system && result.prompt) {
        const { system, prompt } = result;
        result.response = await limit.track(async () => {
          const model = await chatModel(modelFeature, 0);
          const reply = await model.invoke([new SystemMessage(system), new HumanMessage(prompt)]);
          return reply.text.trim();
        });
      }

      if (!result.response) {
        await limit.refund();
        return NextResponse.json({ error: 'Script returned no response' }, { status: 500 });
      }

      return NextResponse.json({ response: result.response, references: result.references ?? [] });
    } catch (error) {
      await limit.refund();
      if (isAiOutOfCredits(error)) {
        return NextResponse.json({ error: (await apiText()).aiOutOfCredits }, { status: 503 });
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Script failed' },
        { status: 500 }
      );
    }
  }

  return { GET, POST };
}
