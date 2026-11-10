// Local AI routing (docs/local-ai.md): request signing, settings, the route decision, the circuit breaker, local
// slots, and the routed chat model's fallback, with fake models and no database or network. Also createAgent with a
// tool, to show a fallback never runs a tool twice. Run with: npm run test:local-ai
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createAgent } from 'langchain';
import { z } from 'zod';
import { defaultLocalAiSettings, parseLocalAiSettings } from '../src/lib/localAi/config.ts';
import { closedCircuit, circuitAfter, circuitAllows, decideRoute, FALLBACK_REASONS } from '../src/lib/localAi/routing.ts';
import { localOutputProblem, RoutedChatModel } from '../src/lib/localAi/routedModel.ts';
import { NonceCache, signRequest, verifyRequest } from '../src/lib/localAi/signing.ts';
import { acquireLocalSlot, configureCapacity, recordHeartbeat, releaseLocalSlot, resetLocalAiState } from '../src/lib/localAi/state.ts';

const SECRET = 'x'.repeat(40);
const parts = { method: 'POST', path: '/api/local-ai/heartbeat', body: '{"a":1}' };

// ---- Signing ----

test('a signed request verifies once, and a replay is refused', () => {
  const nonces = new NonceCache();
  const now = 1_800_000_000_000;
  const headers = signRequest(SECRET, 'heartbeat', parts, now);
  assert.deepEqual(verifyRequest(SECRET, 'heartbeat', parts, headers, nonces, now + 1000), { ok: true });
  assert.deepEqual(verifyRequest(SECRET, 'heartbeat', parts, headers, nonces, now + 2000), { ok: false, reason: 'replayed' });
});

test('signatures fail on a changed body, path, purpose, secret or an old timestamp', () => {
  const now = 1_800_000_000_000;
  const headers = signRequest(SECRET, 'heartbeat', parts, now);
  const check = (p, purpose = 'heartbeat', secret = SECRET, at = now) => verifyRequest(secret, purpose, p, headers, new NonceCache(), at);
  assert.equal(check({ ...parts, body: '{"a":2}' }).reason, 'badSignature');
  assert.equal(check({ ...parts, path: '/other' }).reason, 'badSignature');
  assert.equal(check(parts, 'inference').reason, 'badSignature');
  assert.equal(check(parts, 'heartbeat', 'y'.repeat(40)).reason, 'badSignature');
  assert.equal(check(parts, 'heartbeat', SECRET, now + 61_000).reason, 'stale');
  assert.equal(verifyRequest(SECRET, 'heartbeat', parts, {}, new NonceCache(), now).reason, 'missing');
});

test('a forged request does not use up its nonce', () => {
  const nonces = new NonceCache();
  const now = 1_800_000_000_000;
  const good = signRequest(SECRET, 'heartbeat', parts, now, 'ab'.repeat(16));
  const forged = { ...good, 'x-rc-signature': '0'.repeat(64) };
  assert.equal(verifyRequest(SECRET, 'heartbeat', parts, forged, nonces, now).reason, 'badSignature');
  assert.deepEqual(verifyRequest(SECRET, 'heartbeat', parts, good, nonces, now), { ok: true });
});

// ---- Settings ----

test('settings default to Cloud Only, and bad values never turn local routing on', () => {
  assert.equal(defaultLocalAiSettings().mode, 'cloudOnly');
  assert.equal(parseLocalAiSettings(null).mode, 'cloudOnly');
  assert.equal(parseLocalAiSettings({ mode: 'turbo' }).mode, 'cloudOnly');
  const parsed = parseLocalAiSettings({
    mode: 'automatic',
    featureModels: { lapSummary: 'llama-huge', debriefCoach: 'qwen3:8b', stintSummary: null, notAFeature: 'qwen3:8b' },
    localTimeoutMs: 1,
    contextShare: 5,
  });
  assert.equal(parsed.mode, 'automatic');
  assert.equal(parsed.featureModels.lapSummary, 'gpt-oss:20b', 'an unknown model keeps the default');
  assert.equal(parsed.featureModels.debriefCoach, 'qwen3:8b');
  assert.equal(parsed.featureModels.stintSummary, null);
  assert.equal('notAFeature' in parsed.featureModels, false);
  assert.equal(parsed.localTimeoutMs, 5_000);
  assert.equal(parsed.contextShare, 0.95);
  // Live and complex features stay on the cloud by default
  for (const feature of ['debriefCoach', 'raceAnnouncer', 'raceEngineer', 'setupEngineer', 'inCarCoachCallouts']) {
    assert.equal(defaultLocalAiSettings().featureModels[feature], null, feature);
  }
});

// ---- Route decisions ----

const NOW = 1_800_000_000_000;
const heartbeat = (over = {}) => ({
  serverId: 'mac',
  sentAt: NOW,
  agentVersion: '1',
  runtime: 'ok',
  installedModels: ['gpt-oss:20b', 'qwen3:8b'],
  loadedModels: ['gpt-oss:20b'],
  activeRequests: 0,
  maxConcurrency: 2,
  queueDepth: 0,
  freeMemoryBytes: null,
  totalMemoryBytes: null,
  accepting: true,
  developmentMode: false,
  ...over,
});
const server = (over = {}) => ({
  id: 'mac',
  enabled: true,
  maxConcurrency: 2,
  heartbeat: heartbeat(),
  receivedAt: NOW - 5_000,
  inFlight: 0,
  circuit: closedCircuit(),
  ...over,
});
const route = (over = {}) =>
  decideRoute({ mode: 'automatic', model: 'gpt-oss:20b', servers: [server()], now: NOW, circuitOpenMs: 60_000, estimatedTokens: 100, contextLimit: 90_000, ...over });

test('Automatic sends a mapped feature to a healthy server', () => {
  assert.deepEqual(route(), { target: 'local', serverId: 'mac', model: 'gpt-oss:20b' });
});

test('Cloud Only and Development never go local; the test console can force it', () => {
  assert.deepEqual(route({ mode: 'cloudOnly' }), { target: 'cloud', reason: 'cloudOnlyMode' });
  assert.deepEqual(route({ mode: 'development' }), { target: 'cloud', reason: 'developmentMode' });
  assert.equal(route({ mode: 'cloudOnly', force: true }).target, 'local');
});

test('every reason a server can not take a call sends it to the cloud', () => {
  assert.equal(route({ model: null }).reason, 'notMapped');
  assert.equal(route({ servers: [] }).reason, 'noServer');
  assert.equal(route({ servers: [server({ enabled: false })] }).reason, 'noServer');
  assert.equal(route({ servers: [server({ receivedAt: NOW - 31_000 })] }).reason, 'localOffline', 'no heartbeat for 30 s');
  assert.equal(route({ servers: [server({ heartbeat: null, receivedAt: null })] }).reason, 'localOffline');
  assert.equal(route({ servers: [server({ heartbeat: heartbeat({ runtime: 'down' }) })] }).reason, 'localOffline');
  assert.equal(route({ servers: [server({ heartbeat: heartbeat({ developmentMode: true }) })] }).reason, 'localNotAccepting');
  assert.equal(route({ servers: [server({ heartbeat: heartbeat({ installedModels: ['qwen3:8b'] }) })] }).reason, 'modelUnavailable');
  assert.equal(route({ servers: [server({ inFlight: 2 })] }).reason, 'localBusy');
  assert.equal(route({ servers: [server({ heartbeat: heartbeat({ maxConcurrency: 1 }), inFlight: 1 })] }).reason, 'localBusy', "the Mac's own limit counts");
  assert.equal(route({ estimatedTokens: 100_000 }).reason, 'contextTooLarge');
  const open = { status: 'open', failures: 3, openedAt: NOW - 1_000, trialInFlight: false };
  assert.equal(route({ servers: [server({ circuit: open })] }).reason, 'circuitOpen');
  for (const reason of ['localOffline', 'localBusy', 'circuitOpen', 'localFailed', 'localTimeout', 'localInvalidOutput']) {
    assert.ok(FALLBACK_REASONS.has(reason), reason);
  }
  for (const reason of ['cloudOnlyMode', 'developmentMode', 'notMapped', 'noServer']) assert.ok(!FALLBACK_REASONS.has(reason), reason);
});

test('with several servers, one with the model loaded and free slots is picked', () => {
  const a = server({ id: 'a', heartbeat: heartbeat({ serverId: 'a', loadedModels: [] }) });
  const b = server({ id: 'b', heartbeat: heartbeat({ serverId: 'b' }) });
  const c = server({ id: 'c', heartbeat: heartbeat({ serverId: 'c' }), inFlight: 2 });
  assert.equal(route({ servers: [a, b, c] }).serverId, 'b');
  assert.equal(route({ servers: [a, server({ id: 'b', receivedAt: NOW - 60_000 })] }).serverId, 'a');
});

test('the circuit opens after repeated failures, then lets one trial through', () => {
  let state = closedCircuit();
  for (let i = 0; i < 3; i++) state = circuitAfter(state, false, NOW, 3);
  assert.equal(state.status, 'open');
  assert.equal(circuitAllows(state, NOW + 30_000, 60_000).allowed, false);
  const trial = circuitAllows(state, NOW + 61_000, 60_000);
  assert.equal(trial.allowed, true);
  assert.equal(trial.next.status, 'halfOpen');
  assert.equal(circuitAllows(trial.next, NOW + 61_500, 60_000).allowed, false, 'one trial at a time');
  assert.equal(circuitAfter(trial.next, false, NOW + 62_000, 3).status, 'open', 'a failed trial reopens it');
  assert.equal(circuitAfter(trial.next, true, NOW + 62_000, 3).status, 'closed', 'a good trial closes it');
});

// ---- The routed model ----

// A chat model whose answers come from a function; bindTools keeps what was bound
class FakeChat extends BaseChatModel {
  constructor(name, respond, binding = null) {
    super({});
    this.name_ = name;
    this.respond = respond;
    this.binding = binding;
    this.calls = 0;
  }
  _llmType() {
    return this.name_;
  }
  get profile() {
    return { structuredOutput: true, toolCalling: true };
  }
  bindTools(tools, kwargs) {
    const bound = new FakeChat(this.name_, this.respond, { tools, kwargs: kwargs ?? {} });
    bound.parent = this;
    return bound;
  }
  async _generate(messages, options) {
    (this.parent ?? this).calls += 1;
    const message = await this.respond(messages, this.binding, options);
    return { generations: [{ text: message.text, message }] };
  }
}

const answer = (text, model) => new AIMessage({ content: text, response_metadata: { model_name: model }, usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });

function routed({ local, cloud, plan = { target: 'local', serverId: 'mac', model: 'qwen3:8b' }, acquire = () => null }) {
  const attempts = [];
  const reports = [];
  let released = 0;
  const model = new RoutedChatModel(cloud, {
    plan: async () => plan,
    acquire,
    release: () => (released += 1),
    reportLocal: (id, ok) => reports.push(ok),
    localModel: () => local,
    record: (a) => attempts.push(a),
    cloudModelName: 'gpt-4o-mini',
    cloudProvider: 'OpenAI',
  });
  return { model, attempts, reports, released: () => released };
}

test('a good local answer is returned and the cloud is never called', async () => {
  const local = new FakeChat('local', () => answer('Local answer', 'qwen3:8b'));
  const cloud = new FakeChat('cloud', () => answer('Cloud answer', 'gpt-4o-mini-2024-07-18'));
  const r = routed({ local, cloud });
  const reply = await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(reply.text, 'Local answer');
  assert.equal(cloud.calls, 0);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].provider, 'Local');
  assert.equal(r.attempts[0].actualModel, 'qwen3:8b');
  assert.equal(r.attempts[0].status, 'completed');
  assert.equal(r.attempts[0].inputTokens, 10);
  assert.deepEqual(r.reports, [true]);
  assert.equal(r.released(), 1);
});

test('a local failure falls back to the cloud, both attempts recorded under one request', async () => {
  const local = new FakeChat('local', () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), { name: 'APIConnectionError' });
  });
  const cloud = new FakeChat('cloud', () => answer('Cloud answer', 'gpt-4o-mini-2024-07-18'));
  const r = routed({ local, cloud });
  const reply = await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(reply.text, 'Cloud answer');
  assert.equal(r.attempts.length, 2);
  const [first, second] = r.attempts;
  assert.equal(first.logicalRequestId, second.logicalRequestId);
  assert.deepEqual([first.attempt, second.attempt], [1, 2]);
  assert.equal(first.status, 'failed');
  assert.equal(first.errorKind, 'connection');
  assert.equal(second.provider, 'OpenAI');
  assert.equal(second.actualModel, 'gpt-4o-mini-2024-07-18');
  assert.equal(second.isFallback, true);
  assert.equal(second.routeReason, 'localFailed');
  assert.deepEqual(r.reports, [false]);
  assert.equal(r.released(), 1);
});

test('a local timeout is recorded as timedOut and falls back', async () => {
  const local = new FakeChat('local', () => {
    throw Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });
  });
  const r = routed({ local, cloud: new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini')) });
  await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(r.attempts[0].status, 'timedOut');
  assert.equal(r.attempts[1].routeReason, 'localTimeout');
});

test('a busy gateway falls back without counting against the circuit', async () => {
  const local = new FakeChat('local', () => {
    throw Object.assign(new Error('All local slots are in use'), { status: 503, error: { error: { type: 'local_busy' } } });
  });
  const r = routed({ local, cloud: new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini')) });
  await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(r.attempts[1].routeReason, 'localBusy');
  assert.deepEqual(r.reports, []);
});

test('a local answer without the JSON the caller asked for falls back', async () => {
  const local = new FakeChat('local', () => answer('Sure! Here is my answer.', 'qwen3:8b'));
  const cloud = new FakeChat('cloud', () => answer('{"ok":true}', 'gpt-4o-mini'));
  const r = routed({ local, cloud });
  const bound = r.model.bindTools([], { response_format: { type: 'json_schema', json_schema: { name: 'x', schema: {} } } });
  const reply = await bound.invoke([new HumanMessage('hi')]);
  assert.equal(reply.text, '{"ok":true}');
  assert.equal(r.attempts[0].errorKind, 'notJson');
  assert.equal(r.attempts[1].routeReason, 'localInvalidOutput');
  assert.equal(cloud.calls, 1);
});

test('local tool calls must name a bound tool, and a required tool call must be made', () => {
  const tools = [{ name: 'get_lap' }];
  const call = (name) => new AIMessage({ content: '', tool_calls: [{ name, args: {}, id: '1', type: 'tool_call' }] });
  assert.equal(localOutputProblem(call('get_lap'), { tools, kwargs: {} }), null);
  assert.equal(localOutputProblem(call('rm_rf'), { tools, kwargs: {} }), 'unknownTool');
  assert.equal(localOutputProblem(call('get_lap'), null), 'unknownTool');
  assert.equal(localOutputProblem(new AIMessage('text'), { tools, kwargs: { tool_choice: 'any' } }), 'noToolCall');
  assert.equal(localOutputProblem(new AIMessage('   '), null), 'empty');
  assert.equal(localOutputProblem(new AIMessage('fine'), null), null);
});

test('when the caller aborts, nothing falls back and the attempt is canceled', async () => {
  const controller = new AbortController();
  const local = new FakeChat('local', async () => {
    controller.abort();
    throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
  });
  const cloud = new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini'));
  const r = routed({ local, cloud });
  await assert.rejects(r.model.invoke([new HumanMessage('hi')], { signal: controller.signal }));
  assert.equal(cloud.calls, 0);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].status, 'canceled');
  assert.deepEqual(r.reports, [], 'not the server’s fault');
});

test('a call routed to the cloud because the Mac is offline is one attempt, marked as a fallback', async () => {
  const local = new FakeChat('local', () => assert.fail('must not be called'));
  const r = routed({ local, cloud: new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini')), plan: { target: 'cloud', reason: 'localOffline' } });
  await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].isFallback, true);
  assert.equal(r.attempts[0].routeReason, 'localOffline');
});

test('a cloud call in Cloud Only mode is not a fallback', async () => {
  const r = routed({ local: null, cloud: new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini')), plan: { target: 'cloud', reason: 'cloudOnlyMode' } });
  await r.model.invoke([new HumanMessage('hi')]);
  assert.equal(r.attempts[0].isFallback, false);
});

test('ten calls at once with two local slots: two run locally, eight go to the cloud', async () => {
  resetLocalAiState();
  configureCapacity('mac', 2);
  recordHeartbeat(heartbeat());
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const local = new FakeChat('local', async () => {
    await gate;
    return answer('Local', 'qwen3:8b');
  });
  const cloud = new FakeChat('cloud', () => answer('Cloud', 'gpt-4o-mini'));
  const attempts = [];
  const model = new RoutedChatModel(cloud, {
    plan: async () => ({ target: 'local', serverId: 'mac', model: 'qwen3:8b' }),
    acquire: (id) => acquireLocalSlot(id),
    release: (id) => releaseLocalSlot(id),
    reportLocal: () => {},
    localModel: () => local,
    record: (a) => attempts.push(a),
    cloudModelName: 'gpt-4o-mini',
    cloudProvider: 'OpenAI',
  });
  const calls = Array.from({ length: 10 }, () => model.invoke([new HumanMessage('hi')]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const replies = await Promise.all(calls);
  assert.equal(replies.filter((r) => r.text === 'Local').length, 2);
  assert.equal(replies.filter((r) => r.text === 'Cloud').length, 8);
  assert.equal(attempts.filter((a) => a.routeReason === 'localBusy').length, 8);
  // The slots were given back
  assert.equal(acquireLocalSlot('mac'), null);
  releaseLocalSlot('mac');
  resetLocalAiState();
});

test('in an agent, a fallback on the second model call never runs the tool twice', async () => {
  let toolRuns = 0;
  const getLap = tool(
    async () => {
      toolRuns += 1;
      return 'Lap 1: 1:42.3';
    },
    { name: 'get_lap', description: 'The lap time', schema: z.object({}) }
  );
  let localCalls = 0;
  // Locally: the first call asks for the tool, the second fails
  const local = new FakeChat('local', () => {
    localCalls += 1;
    if (localCalls === 1) {
      return new AIMessage({ content: '', tool_calls: [{ name: 'get_lap', args: {}, id: 'call_1', type: 'tool_call' }] });
    }
    throw new Error('Ollama crashed');
  });
  const cloud = new FakeChat('cloud', (messages) => {
    assert.ok(messages.some((m) => m.getType() === 'tool'), 'the cloud gets the tool result the local model asked for');
    return answer('{"summary":"Your lap was 1:42.3"}', 'gpt-4o-mini');
  });
  const r = routed({ local, cloud });
  const agent = createAgent({
    model: r.model,
    tools: [getLap],
    responseFormat: z.object({ summary: z.string() }),
  });
  const result = await agent.invoke({ messages: [new HumanMessage('How was my lap?')] });
  assert.equal(result.structuredResponse.summary, 'Your lap was 1:42.3');
  assert.equal(toolRuns, 1);
  assert.deepEqual(
    r.attempts.map((a) => `${a.provider}:${a.status}`),
    ['Local:completed', 'Local:failed', 'OpenAI:completed']
  );
  assert.notEqual(r.attempts[0].logicalRequestId, r.attempts[1].logicalRequestId, 'each model call is its own logical request');
  assert.equal(r.attempts[1].logicalRequestId, r.attempts[2].logicalRequestId);
});
