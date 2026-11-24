'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { KNOWLEDGE_PRESETS } from '@/lib/aiLab/rules';
import { buttonClass, errorText, labApi, localTime, Notice, Panel, primaryClass, type LabOverview } from './aiLabUi';

// AI Lab's Knowledge tab: Open WebUI's knowledge bases on the Mac (listed through the gateway), the suggested ones
// created on request, and the embedding model recommendation. Documents are uploaded in Open WebUI itself; nothing
// from RacingCoach's database ever goes in automatically, and these are separate from production's RAG.

type Kb = { id: string; name: string; description: string; files: number | null; updatedAt: number | null };

export default function AiLabKnowledge({ data }: { data: LabOverview | null }) {
  const { t, fmt } = useLanguage();
  const l = t.aiLab;
  const k = l.knowledge;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const ready = Boolean(gw?.openWebui.apiKey);
  const [list, setList] = useState<Kb[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await labApi<{ knowledge: Kb[] }>('/api/admin/ai-lab/webui', { body: { action: 'knowledge.list' } })).knowledge);
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    }
  }, [l]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once Open WebUI is reachable
    if (ready) void load();
  }, [ready, load]);

  const names = new Set((list ?? []).map((x) => x.name.toLowerCase()));
  const missing = KNOWLEDGE_PRESETS.filter((key) => !names.has(k.presets[key].name.toLowerCase()));

  const createMissing = async () => {
    setBusy(true);
    setProblem(null);
    try {
      for (const key of missing) {
        await labApi('/api/admin/ai-lab/webui', { body: { action: 'knowledge.create', name: k.presets[key].name, description: k.presets[key].description } });
      }
      await load();
    } catch (e) {
      setProblem(errorText(e, l.errors, l.common.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title={k.title} intro={k.intro}>
        {!gw ? (
          <Notice tone="warn">{l.common.macOffline}</Notice>
        ) : !ready ? (
          <Notice tone="warn">{l.common.webuiNotConfigured}</Notice>
        ) : (
          <>
            {problem && <Notice tone="error">{problem}</Notice>}
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-foreground">{k.list}</h3>
              <button type="button" className={buttonClass} onClick={() => void load()}>
                {l.common.refresh}
              </button>
            </div>
            {list === null ? (
              <p className="text-sm text-muted-foreground">{l.common.loading}</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{k.empty}</p>
            ) : (
              <ul className="divide-y divide-border/60 text-sm">
                {list.map((x) => (
                  <li key={x.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="text-foreground">{x.name}</span>
                      {x.description && <span className="block text-xs text-muted-foreground">{x.description}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {x.files !== null ? fmt(k.files, { n: x.files }) : ''} {localTime(x.updatedAt) ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{k.suggested}</h3>
              <ul className="text-sm grid sm:grid-cols-2 gap-1">
                {KNOWLEDGE_PRESETS.map((key) => (
                  <li key={key} className="flex justify-between gap-2 rounded border border-border px-2 py-1">
                    <span>{k.presets[key].name}</span>
                    {names.has(k.presets[key].name.toLowerCase()) && <span className="text-xs text-green-500">{k.exists}</span>}
                  </li>
                ))}
              </ul>
              <button type="button" className={`${primaryClass} mt-2`} disabled={busy || missing.length === 0 || list === null} onClick={() => void createMissing()}>
                {k.createMissing}
              </button>
            </div>
            <Notice>{k.upload}</Notice>
          </>
        )}
      </Panel>
      <Panel title={k.embeddingTitle}>
        <p className="text-sm text-muted-foreground">{k.embeddingText}</p>
      </Panel>
    </div>
  );
}
