// The AI Lab's pure rules (src/lib/aiLab/rules.ts): model names that can't become paths or options, registry names,
// parameters per provider and their ranges, Ollama's option names, measurements, settings parsing, status colors,
// and the guards that keep the lab apart from production (Admin-only routes, no production routing reads the lab's
// settings). Run with: npm run test:ai-lab
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  cleanParams,
  CONFIG_PRESETS,
  KNOWLEDGE_PRESETS,
  ollamaOptions,
  parseAiLabSettings,
  registryName,
  serviceColor,
  supportedParams,
  tokensPerSecond,
  validConfigId,
  validModelName,
  validOpenWebuiUrl,
  validWebuiId,
  worstCaseCostUsd,
} from '../src/lib/aiLab/rules.ts';

describe('names', () => {
  test('real Ollama names are accepted', () => {
    for (const name of ['qwen3:8b', 'gpt-oss:20b', 'gemma3:27b', 'library/llama3.2:3b', 'hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M', 'mistral-small3.2', 'deepseek-r1:14b', 'qwen3-embedding:0.6b']) {
      assert.ok(validModelName(name), name);
    }
  });

  test('anything that could be a path, URL, option or two tags is refused', () => {
    for (const name of ['../x', 'a/../b', '/abs', 'x/', 'x:', 'a b', '-rf', 'http://x/y', 'a//b', 'a:b:c', '', 'x'.repeat(201), 'qwen3;rm', 'q$(id)']) {
      assert.equal(validModelName(name), false, name);
    }
  });

  test('registry names split into namespace, model and tag; other hosts have none', () => {
    assert.deepEqual(registryName('gemma3:27b'), { namespace: 'library', model: 'gemma3', tag: '27b' });
    assert.deepEqual(registryName('qwen3'), { namespace: 'library', model: 'qwen3', tag: 'latest' });
    assert.deepEqual(registryName('someone/model:v1'), { namespace: 'someone', model: 'model', tag: 'v1' });
    assert.equal(registryName('hf.co/user/repo:Q4_K_M'), null);
    assert.equal(registryName('a/b/c'), null);
  });

  test('Open WebUI IDs', () => {
    assert.ok(validWebuiId('3f2b8c1e-0000-4000-8000-1234567890ab'));
    assert.equal(validWebuiId('../models'), false);
    assert.ok(validConfigId('racingcoach-race-engineer'));
    assert.equal(validConfigId('Has Space'), false);
    for (const preset of CONFIG_PRESETS) assert.ok(validConfigId(preset.id), preset.id);
  });
});

describe('parameters', () => {
  test('each provider gets only what it takes', () => {
    assert.deepEqual(supportedParams('Local', 'qwen3:8b').length, 7);
    assert.deepEqual(supportedParams('OpenAI', 'gpt-4o-mini'), ['temperature', 'topP', 'maxTokens', 'seed']);
    assert.deepEqual(supportedParams('OpenAI', 'gpt-5-mini'), ['maxTokens']);
    assert.deepEqual(supportedParams('Anthropic', 'claude-sonnet-5-5'), ['maxTokens']);
    assert.deepEqual(supportedParams('DeepSeek', 'deepseek-flash'), ['temperature', 'topP', 'maxTokens']);
  });

  test('unsupported, invalid and out-of-range values are dropped or clamped', () => {
    assert.deepEqual(cleanParams({ temperature: 5, topK: 40, seed: 1.6, maxTokens: 'x', bogus: 1 }, supportedParams('OpenAI', 'gpt-4o')), { temperature: 2, seed: 2 });
    assert.deepEqual(cleanParams({ numCtx: 10_000_000, repeatPenalty: 0 }, supportedParams('Local', 'x')), { numCtx: 131_072, repeatPenalty: 0.5 });
    assert.deepEqual(cleanParams(null, supportedParams('Local', 'x')), {});
    assert.deepEqual(cleanParams({ temperature: '' }, supportedParams('Local', 'x')), {});
  });

  test("Ollama's option names", () => {
    assert.deepEqual(ollamaOptions({ temperature: 0.2, topP: 0.9, topK: 20, numCtx: 8192, maxTokens: 100, repeatPenalty: 1.1, seed: 3 }), {
      temperature: 0.2,
      top_p: 0.9,
      top_k: 20,
      num_ctx: 8192,
      num_predict: 100,
      repeat_penalty: 1.1,
      seed: 3,
    });
  });
});

describe('measurements and settings', () => {
  test('tokens per second, and nothing when it can\'t be measured', () => {
    assert.equal(tokensPerSecond(40, 2000), 20);
    assert.equal(tokensPerSecond(null, 2000), null);
    assert.equal(tokensPerSecond(40, 0), null);
  });

  test('worst-case cost counts every output token allowed', () => {
    assert.equal(worstCaseCostUsd({ input: 1, output: 10 }, 1000, 1000), 0.011);
  });

  test('settings: bad values take defaults, the URL must be https without a path', () => {
    assert.deepEqual(parseAiLabSettings(null), { openWebuiUrl: null, dailyCloudBudgetUsd: 2, defaultModel: null, modelParams: {} });
    const s = parseAiLabSettings({ openWebuiUrl: 'https://ai-lab.racingcoach.app/', dailyCloudBudgetUsd: 5000, defaultModel: '../x', modelParams: { 'qwen3:8b': { temperature: 0.3, bogus: 1 }, '../x': {} } });
    assert.equal(s.openWebuiUrl, 'https://ai-lab.racingcoach.app');
    assert.equal(s.dailyCloudBudgetUsd, 100);
    assert.equal(s.defaultModel, null);
    assert.deepEqual(s.modelParams, { 'qwen3:8b': { temperature: 0.3 } });
    for (const bad of ['http://ai-lab.racingcoach.app', 'https://x/path', 'https://u:p@x', 'javascript:alert(1)', 'https://x?q=1']) assert.equal(validOpenWebuiUrl(bad), null, bad);
  });

  test('status colors: gray not configured, yellow degraded or unknown, red down, green healthy', () => {
    assert.equal(serviceColor({ configured: false, ok: true }), 'gray');
    assert.equal(serviceColor({ configured: true, ok: null }), 'yellow');
    assert.equal(serviceColor({ configured: true, ok: false }), 'red');
    assert.equal(serviceColor({ configured: true, ok: true, degraded: true }), 'yellow');
    assert.equal(serviceColor({ configured: true, ok: true }), 'green');
  });
});

describe('guards', () => {
  const read = (p) => readFileSync(p, 'utf8');
  const routes = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routes(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : []));

  test('every AI Lab route checks the Admin role first', () => {
    const files = routes('src/app/api/admin/ai-lab');
    assert.ok(files.length >= 6);
    for (const file of files) {
      const source = read(file);
      for (const handler of source.matchAll(/export async function (GET|POST|PUT|DELETE)\([^)]*\) \{\n\s+const \{[^}]*denied[^}]*\} = await labAdmin\(\);\n\s+if \(denied\) return denied;/g)) assert.ok(handler);
      const handlers = [...source.matchAll(/export async function (GET|POST|PUT|DELETE)/g)].length;
      const guarded = [...source.matchAll(/= await labAdmin\(\);\n\s+if \(denied\) return denied;/g)].length;
      assert.equal(guarded, handlers, `${file}: every handler starts with labAdmin()`);
      assert.doesNotMatch(source, /request\.(json|text|formData|arrayBuffer)\(\)/, `${file} reads bodies through readJsonLimited`);
    }
  });

  test('production routing never reads the lab', () => {
    for (const file of ['src/lib/aiModels.ts', 'src/lib/localAi/router.ts', 'src/lib/localAi/routedModel.ts', 'src/lib/localAi/routing.ts', 'src/lib/localAi/config.ts']) {
      // aiModels.ts ends with the lab's own cloud model builder, which production code never calls
      const source = read(file).split("// The AI Lab playground's cloud model")[0];
      assert.doesNotMatch(source, /aiLab|ai_lab/, file);
    }
  });

  test('the gateway keeps Ollama and Open WebUI to fixed local paths', () => {
    const lab = read('local-ai/lab.ts');
    // Every Ollama call is to a literal /api/... path
    for (const call of lab.matchAll(/\bollama\((?!path)([^,)]+)/g)) assert.match(call[1], /^'\/api\/[a-z]+'$/, call[0]);
    // Open WebUI calls are to /api/v1/... with only checked IDs interpolated
    for (const call of lab.matchAll(/\bwebui\((?!path)([^,)]+)/g)) assert.match(call[1], /^[`']\/api\/v1\/(memories|knowledge|models)\//, call[0]);
    assert.doesNotMatch(lab, /OPEN_WEBUI_API_KEY[^\n]*send\(/);
  });

  test('the knowledge presets have names in every language', async () => {
    for (const lang of ['', 'De', 'Es', 'Fr', 'It', 'Pt']) {
      const mod = await import(`../src/lib/i18n/dictionaries/aiLabText${lang}.ts`);
      const text = Object.values(mod)[0];
      for (const key of KNOWLEDGE_PRESETS) assert.ok(text.knowledge.presets[key].name, `${lang} ${key}`);
      for (const preset of CONFIG_PRESETS) assert.ok(text.configs.presets[preset.key], `${lang} ${preset.key}`);
    }
  });
});
