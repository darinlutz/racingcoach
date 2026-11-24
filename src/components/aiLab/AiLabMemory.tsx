'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { buttonClass, dangerClass, errorText, inputClass, labApi, labelClass, localTime, Notice, Panel, primaryClass, type LabOverview, chatModelNames } from './aiLabUi';
import { runModel } from './playgroundClient';

// AI Lab's Memory tab: Open WebUI's persistent memories (its own feature, through the Mac's gateway): view, search,
// add, edit and delete them, and Test retrieval, which asks Open WebUI's memory search what it finds for a question
// and can then ask a local model with those memories in its system prompt. What memory is, and isn't (training), is
// spelled out beside it.

type Memory = { id: string; content: string; updatedAt: number | null };
type Found = { id: string; content: string | null; distance: number | null };

export default function AiLabMemory({ data }: { data: LabOverview | null }) {
  const { t, fmt, number } = useLanguage();
  const l = t.aiLab;
  const m = l.memory;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const call = useCallback(
    async <T,>(action: string, body: Record<string, unknown> = {}): Promise<T | null> => {
      setProblem(null);
      try {
        return await labApi<T>('/api/admin/ai-lab/webui', { body: { action, ...body } });
      } catch (e) {
        setProblem(errorText(e, l.errors, l.common.failed));
        return null;
      }
    },
    [l]
  );

  const load = useCallback(async () => {
    const r = await call<{ memories: Memory[] }>('memories.list');
    if (r) setMemories(r.memories);
  }, [call]);

  const webuiReady = Boolean(gw?.openWebui.apiKey);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the memories once Open WebUI is reachable
    if (webuiReady) void load();
  }, [webuiReady, load]);
  const chatModels = chatModelNames(gw);
  const model = picked || (chatModels.includes(data?.settings.defaultModel ?? '') ? data!.settings.defaultModel! : chatModels[0]) || '';

  const add = async () => {
    if (await call('memories.add', { content: draft })) {
      setDraft('');
      await load();
    }
  };
  const save = async () => {
    if (editing && (await call('memories.update', editing))) {
      setEditing(null);
      await load();
    }
  };
  const remove = async (id: string) => {
    if (window.confirm(m.confirmDelete) && (await call('memories.delete', { id }))) await load();
  };
  const find = async () => {
    setAnswer(null);
    const r = await call<{ results: Found[] }>('memories.query', { content: question, k: 3 });
    if (r) setFound(r.results);
  };
  const ask = async () => {
    if (!found) return;
    setBusy(true);
    setAnswer(null);
    const facts = found.map((f) => `- ${f.content}`).join('\n');
    const result = await runModel({
      target: { provider: 'Local', model },
      system: found.length ? `Facts the user asked you to remember:\n${facts}` : '',
      prompt: question,
      params: {},
    });
    setBusy(false);
    setAnswer(result.error ? fmt(l.common.failed, { error: (l.errors as Record<string, string>)[result.error] ?? result.error }) : result.text);
  };

  const shown = (memories ?? []).filter((x) => !filter.trim() || x.content.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <Panel title={m.title} intro={m.intro}>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{m.kinds}</h3>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
            <li>{m.kindHistory}</li>
            <li>{m.kindShortTerm}</li>
            <li className="text-foreground">{m.kindMemory}</li>
            <li>{m.kindRag}</li>
            <li>{m.kindFineTuned}</li>
          </ul>
        </div>
        <Notice>{m.notTraining}</Notice>
        <Notice>{m.toggle}</Notice>
      </Panel>

      {!gw ? (
        <Notice tone="warn">{l.common.macOffline}</Notice>
      ) : !webuiReady ? (
        <Notice tone="warn">{l.common.webuiNotConfigured}</Notice>
      ) : (
        <>
          <Panel title={l.tabs.memory}>
            {problem && <Notice tone="error">{problem}</Notice>}
            <div className="flex flex-wrap gap-2">
              <input className={`${inputClass} max-w-xl`} data-no-track value={draft} maxLength={4000} placeholder={m.add} onChange={(e) => setDraft(e.target.value)} aria-label={m.add} />
              <button type="button" className={primaryClass} disabled={!draft.trim()} onClick={() => void add()}>
                {l.common.add}
              </button>
              <input className={`${inputClass} max-w-xs`} value={filter} placeholder={m.search} onChange={(e) => setFilter(e.target.value)} aria-label={m.search} />
              <button type="button" className={buttonClass} onClick={() => void load()}>
                {l.common.refresh}
              </button>
            </div>
            {memories === null ? (
              <p className="text-sm text-muted-foreground">{l.common.loading}</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{m.empty}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {shown.map((x) => (
                  <li key={x.id} className="py-2 flex flex-wrap gap-2 items-start justify-between">
                    {editing?.id === x.id ? (
                      <input className={`${inputClass} flex-1`} data-no-track value={editing.content} maxLength={4000} onChange={(e) => setEditing({ id: x.id, content: e.target.value })} aria-label={l.common.edit} />
                    ) : (
                      <span className="text-sm text-foreground flex-1 break-words" data-no-track>
                        {x.content}
                        {x.updatedAt && <span className="block text-xs text-muted-foreground">{fmt(m.updated, { time: localTime(x.updatedAt) ?? '' })}</span>}
                      </span>
                    )}
                    <span className="flex gap-1">
                      {editing?.id === x.id ? (
                        <>
                          <button type="button" className={primaryClass} onClick={() => void save()}>
                            {l.common.save}
                          </button>
                          <button type="button" className={buttonClass} onClick={() => setEditing(null)}>
                            {l.common.cancel}
                          </button>
                        </>
                      ) : (
                        <button type="button" className={buttonClass} onClick={() => setEditing({ id: x.id, content: x.content })}>
                          {l.common.edit}
                        </button>
                      )}
                      <button type="button" className={dangerClass} onClick={() => void remove(x.id)}>
                        {l.common.delete}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={m.testTitle} intro={m.testHelp}>
            <div>
              <label className={labelClass} htmlFor="ai-lab-memory-question">{m.question}</label>
              <input id="ai-lab-memory-question" data-no-track className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" className={buttonClass} disabled={!question.trim()} onClick={() => void find()}>
                {m.findMemories}
              </button>
              <select className={`${inputClass} max-w-xs`} value={model} onChange={(e) => setPicked(e.target.value)} aria-label={l.models.name}>
                {chatModels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button type="button" className={primaryClass} disabled={!found || busy || !model} onClick={() => void ask()}>
                {busy ? l.playground.running : fmt(m.askWith, { model })}
              </button>
            </div>
            {found && (
              <div>
                <p className="text-sm font-semibold text-foreground">{fmt(m.found, { n: found.length })}</p>
                {found.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{m.noneFound}</p>
                ) : (
                  <ul className="text-sm list-disc pl-5">
                    {found.map((f) => (
                      <li key={f.id}>
                        {f.content}
                        {f.distance !== null && <span className="text-xs text-muted-foreground"> ({fmt(m.distance, { d: number(f.distance, { maximumFractionDigits: 3 }) })})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {answer !== null && (
              <div className="rounded-lg border border-border bg-card p-3 space-y-1">
                <p className="text-sm text-foreground whitespace-pre-wrap">{answer}</p>
                <p className="text-xs text-muted-foreground">{m.injected}</p>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
