'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { CONFIG_PRESETS } from '@/lib/aiLab/rules';
import { buttonClass, errorText, inputClass, labApi, Notice, Panel, primaryClass, type LabOverview, chatModelNames } from './aiLabUi';

// AI Lab's Model Configurations tab: Open WebUI workspace models (a base model with a system prompt, parameters and
// knowledge bases; the weights unchanged) listed through the gateway, and the starting points created on a chosen
// base model. Each is labelled a configuration: nothing here is a fine-tuned model, and none of it is ever used by
// production AI.

type Config = { id: string; name: string; baseModelId: string | null; description: string; knowledge: number; hasSystem: boolean; kind: string | null };

export default function AiLabConfigs({ data }: { data: LabOverview | null }) {
  const { t, fmt } = useLanguage();
  const l = t.aiLab;
  const c = l.configs;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const ready = Boolean(gw?.openWebui.apiKey);
  const [list, setList] = useState<Config[] | null>(null);
  const [picked, setPicked] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await labApi<{ models: Config[] }>('/api/admin/ai-lab/webui', { body: { action: 'models.list' } })).models);
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    }
  }, [l]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once Open WebUI is reachable
    if (ready) void load();
  }, [ready, load]);
  const chatModels = chatModelNames(gw);
  const base = picked || (chatModels.includes(data?.settings.defaultModel ?? '') ? data!.settings.defaultModel! : chatModels[0]) || '';

  const create = async (preset: (typeof CONFIG_PRESETS)[number]) => {
    setProblem(null);
    setMessage(null);
    try {
      await labApi('/api/admin/ai-lab/webui', {
        body: {
          action: 'models.create',
          id: preset.id,
          name: preset.name,
          baseModelId: base,
          description: c.presets[preset.key],
          system: preset.system,
          params: { temperature: preset.temperature },
        },
      });
      setMessage(`${c.created}: ${preset.name}. ${c.afterCreate}`);
      await load();
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    }
  };

  const existing = new Set((list ?? []).map((x) => x.id));

  return (
    <div className="space-y-4">
      <Panel title={c.title} intro={c.intro}>
        <Notice>{c.notProduction}</Notice>
        {!gw ? (
          <Notice tone="warn">{l.common.macOffline}</Notice>
        ) : !ready ? (
          <Notice tone="warn">{l.common.webuiNotConfigured}</Notice>
        ) : (
          <>
            {problem && <Notice tone="error">{problem}</Notice>}
            {message && <Notice>{message}</Notice>}
            <div className="flex justify-end">
              <button type="button" className={buttonClass} onClick={() => void load()}>
                {l.common.refresh}
              </button>
            </div>
            {list === null ? (
              <p className="text-sm text-muted-foreground">{l.common.loading}</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{c.empty}</p>
            ) : (
              <ul className="divide-y divide-border/60 text-sm">
                {list.map((x) => (
                  <li key={x.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-foreground">{x.name}</span>
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{c.configuration}</span>
                      {x.description && <span className="block text-xs text-muted-foreground">{x.description}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.base}: {x.baseModelId ?? l.common.unavailable} · {fmt(c.knowledge, { n: x.knowledge })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">{c.presetsTitle}</h3>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <label className="text-sm text-muted-foreground" htmlFor="ai-lab-config-base">{c.createOn}</label>
                <select id="ai-lab-config-base" className={`${inputClass} max-w-xs`} value={base} onChange={(e) => setPicked(e.target.value)}>
                  {chatModels.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {CONFIG_PRESETS.map((preset) => (
                  <li key={preset.key} className="rounded border border-border p-2 flex justify-between items-center gap-2">
                    <span className="text-sm text-foreground">{c.presets[preset.key]}</span>
                    {existing.has(preset.id) ? (
                      <span className="text-xs text-green-500">{l.knowledge.exists}</span>
                    ) : (
                      <button type="button" className={primaryClass} disabled={!base} onClick={() => void create(preset)}>
                        {l.common.create}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">{c.modelfile}</p>
      </Panel>
    </div>
  );
}
