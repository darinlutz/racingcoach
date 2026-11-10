import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { cloudChatModel } from '@/lib/aiModels';
import type { AiModel } from '@/lib/aiModelList';
import { siteAiCall } from '@/lib/rateLimits';
import type { LocalModelId } from './config';
import { gatewayHealth } from './localModel';
import type { InferenceAttempt } from './routedModel';
import { createRoutedModel } from './router';
import { liveServer } from './state';
import { listLocalAiServers } from './store';

// The Admin page's Local AI Test Console (docs/local-ai.md). A prompt goes through the same router, local model and
// event recording as the site's AI features (feature localAiTest, source testConsole), so what it shows, and the row
// it adds to AI Inference Monitoring, is a real model call: never a mock. It's the site's own AI call (siteAiCall):
// its cloud tokens are logged in AiUsage and counted by the spend monitor, never against a user.

export const TEST_CLOUD_MODEL: AiModel = 'gpt-4o-mini';
export const MAX_TEST_PROMPT = 4000;

const SYSTEM =
  "You are RacingCoach's race engineering assistant, being tested from the Admin page. Answer the question clearly " +
  'in at most two short paragraphs.';

export type TestRouting = 'production' | 'forceLocal' | 'simulateFailure';

export type TestResult = {
  text: string;
  attempts: InferenceAttempt[];
  totalMs: number;
};

// production: as a feature mapped to this model would go in the current mode (Cloud Only and Development go to the
// cloud). forceLocal: local whatever the mode, falling back to the cloud if it fails. simulateFailure: the local
// attempt fails at once, so the cloud fallback and its recording can be seen without unplugging the Mac.
export async function runTestPrompt(options: {
  prompt: string;
  model: LocalModelId;
  serverId: string | null;
  routing: TestRouting;
}): Promise<TestResult> {
  const started = performance.now();
  const attempts: InferenceAttempt[] = [];
  const text = await siteAiCall('localAiTest', async () => {
    const model = createRoutedModel({
      context: { feature: 'localAiTest', category: 'Admin', source: 'testConsole' },
      temperature: 0.3,
      cloud: cloudChatModel(TEST_CLOUD_MODEL, 'localAiTest', 0.3, []),
      cloudModelName: TEST_CLOUD_MODEL,
      maxOutputTokens: 1500,
      featureTimeoutMs: 120_000,
      force: {
        model: options.model,
        serverId: options.serverId,
        ignoreMode: options.routing !== 'production',
        simulateLocalFailure: options.routing === 'simulateFailure',
      },
      onAttempt: (attempt) => attempts.push(attempt),
    });
    const reply = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage(options.prompt)]);
    return reply.text.trim();
  });
  return { text, attempts, totalMs: Math.round(performance.now() - started) };
}

export type ConnectivityResult = {
  serverId: string;
  gatewayUrl: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  body: unknown;
  error: string | null;
  heartbeatAgeMs: number | null;
};

// A signed GET of each server's /health through Cloudflare: proves the tunnel, the Access service token and the
// shared secret all work, and what the gateway says about Ollama
export async function testConnectivity(serverId: string | null): Promise<ConnectivityResult[]> {
  const servers = (await listLocalAiServers(true)).filter((server) => !serverId || server.id === serverId);
  return Promise.all(
    servers.map(async (server) => {
      const live = liveServer(server.id);
      const heartbeatAgeMs = live.receivedAt ? Date.now() - live.receivedAt : null;
      try {
        const health = await gatewayHealth(server.gatewayUrl);
        return {
          serverId: server.id,
          gatewayUrl: server.gatewayUrl,
          ok: health.status === 200,
          status: health.status,
          latencyMs: health.latencyMs,
          body: health.body,
          error: null,
          heartbeatAgeMs,
        };
      } catch (error) {
        return {
          serverId: server.id,
          gatewayUrl: server.gatewayUrl,
          ok: false,
          status: null,
          latencyMs: null,
          body: null,
          error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'Failed',
          heartbeatAgeMs,
        };
      }
    })
  );
}
