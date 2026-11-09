import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { aiModelProvider } from '@/lib/aiModelList';
import { LOCAL_MODELS, estimateTokens, type LocalAiSettings, type LocalModelId } from './config';
import { recordAttempt, type EventContext } from './events';
import { localChatModel } from './localModel';
import { RoutedChatModel, type InferenceAttempt } from './routedModel';
import { decideRoute, type RouteReason, type ServerSnapshot } from './routing';
import { acquireLocalSlot, configureCapacity, configureCircuit, liveServer, releaseLocalSlot, reportLocalResult } from './state';
import { getLocalAiSettings, listLocalAiServers, type LocalAiServer } from './store';

// The model router's server side (docs/local-ai.md): chatModel (src/lib/aiModels.ts) asks localRouteFor whether a
// feature may use a local server at all (the mode and the feature's mapping), and if so wraps the feature's cloud
// model in a RoutedChatModel, which decides each model call from the registered servers, their heartbeats, free
// slots and circuit breakers. Any failure to read the settings means the cloud, as before.

export type LocalRoute = { kind: 'cloud'; reason: RouteReason } | { kind: 'routed'; settings: LocalAiSettings };

export async function localRouteFor(feature: string): Promise<LocalRoute> {
  try {
    const settings = await getLocalAiSettings();
    configureCircuit(settings.circuitOpenMs, settings.circuitFailures);
    if (settings.mode === 'cloudOnly') return { kind: 'cloud', reason: 'cloudOnlyMode' };
    if (settings.mode === 'development') return { kind: 'cloud', reason: 'developmentMode' };
    const model = (settings.featureModels as Record<string, LocalModelId | null>)[feature];
    if (!model) return { kind: 'cloud', reason: 'notMapped' };
    return { kind: 'routed', settings };
  } catch (error) {
    console.error('Failed to read the local AI settings; using the cloud model:', error);
    return { kind: 'cloud', reason: 'settingsUnavailable' };
  }
}

export function serverSnapshots(servers: LocalAiServer[]): ServerSnapshot[] {
  return servers.map((server) => {
    configureCapacity(server.id, server.maxConcurrency);
    const live = liveServer(server.id);
    return {
      id: server.id,
      enabled: server.enabled,
      maxConcurrency: server.maxConcurrency,
      heartbeat: live.heartbeat,
      receivedAt: live.receivedAt,
      inFlight: live.inFlight,
      circuit: live.circuit,
    };
  });
}

export type RoutedModelOptions = {
  context: EventContext;
  temperature: number;
  cloud: BaseChatModel;
  cloudModelName: string;
  maxOutputTokens: number;
  featureTimeoutMs: number;
  // The Admin test console: this local model in place of the feature's mapping, on one server or any; ignoreMode
  // sends it local whatever the mode (Force Local); simulateLocalFailure makes the local attempt fail
  force?: { model: LocalModelId; serverId?: string | null; ignoreMode?: boolean; simulateLocalFailure?: boolean };
  // Also told of every attempt (the test console shows them)
  onAttempt?: (attempt: InferenceAttempt) => void;
};

export function createRoutedModel(options: RoutedModelOptions): BaseChatModel {
  let servers: LocalAiServer[] = [];
  let settings: LocalAiSettings | null = null;
  return new RoutedChatModel(options.cloud, {
    plan: async (requestText) => {
      // Read for every call, so a mode change applies to an agent's next model call
      settings = await getLocalAiSettings();
      configureCircuit(settings.circuitOpenMs, settings.circuitFailures);
      servers = await listLocalAiServers();
      const forcedServer = options.force?.serverId;
      const candidates = forcedServer ? servers.filter((server) => server.id === forcedServer) : servers;
      const model = options.force?.model ?? (settings.featureModels as Record<string, LocalModelId | null>)[options.context.feature] ?? null;
      return decideRoute({
        mode: settings.mode,
        model,
        servers: serverSnapshots(candidates),
        now: Date.now(),
        circuitOpenMs: settings.circuitOpenMs,
        estimatedTokens: estimateTokens(requestText),
        contextLimit: model ? LOCAL_MODELS[model].contextTokens * settings.contextShare : 0,
        force: Boolean(options.force?.ignoreMode),
      });
    },
    acquire: (serverId) => acquireLocalSlot(serverId),
    release: (serverId) => releaseLocalSlot(serverId),
    reportLocal: (serverId, ok) => reportLocalResult(serverId, ok),
    localModel: (plan) => {
      const server = servers.find((s) => s.id === plan.serverId);
      if (!server) throw new Error(`Local AI server ${plan.serverId} is not registered`);
      return localChatModel({
        gatewayUrl: server.gatewayUrl,
        model: plan.model,
        temperature: options.temperature,
        // gpt-oss and Qwen3 think before answering, and that counts as output
        maxTokens: options.maxOutputTokens * 2,
        timeoutMs: Math.min(settings?.localTimeoutMs ?? 60_000, options.featureTimeoutMs),
      });
    },
    record: (attempt) => {
      recordAttempt(options.context, attempt);
      options.onAttempt?.(attempt);
    },
    cloudModelName: options.cloudModelName,
    cloudProvider: aiModelProvider(options.cloudModelName),
    simulateLocalFailure: options.force?.simulateLocalFailure,
  });
}
