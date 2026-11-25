'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, danger, day, Field, input, memApi, Notice, Pill, primary, Section, useErrorText, useMemApi } from './memoryUi';

// Conflicts side by side: the existing memory and the proposal, their evidence, confidence, dates and similarity,
// the explanation and the recommended resolution. Locked memories refuse anything that would change them.

type Conflict = {
  id: string;
  kind: string;
  status: string;
  similarity: number | null;
  explanation: string;
  recommended: string;
  detectedBy: string;
  createdAt: string;
  resolution: string | null;
  existing: { id: string; title: string; content: string; isLocked: boolean; confidence: number; updatedAt: string; createdAt: string; sourceApplication: string; namespacePath: string };
  proposed: { kind: string; id: string; title: string; content: string; confidence: number; createdAt: string; evidence: string; sourceApplication: string } | null;
};

const RESOLUTIONS = ['keepExisting', 'replace', 'merge', 'keepBoth', 'supersede', 'reject', 'defer'] as const;

export default function MmConflicts() {
  const { t, fmt, number } = useLanguage();
  const m = t.aiLab.memoryManager;
  const c = m.conflicts;
  const errorText = useErrorText();
  const [show, setShow] = useState<'open' | 'resolved' | 'all'>('open');
  const { data, error, reload } = useMemApi<{ conflicts: Conflict[] }>(`/conflicts?status=${show}`);
  const [merged, setMerged] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const resolve = async (id: string, resolution: string) => {
    setMessage(null);
    try {
      await memApi(`/conflicts/${id}/resolve`, { body: { resolution, mergedContent: merged[id] || undefined } });
      await reload();
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  const side = (title: string, x: { title: string; content: string; confidence: number; createdAt: string; sourceApplication: string }, extra?: React.ReactNode) => (
    <div className="rounded-lg border border-border p-3 space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="font-medium text-foreground">{x.title}</div>
      <p className="text-sm text-foreground">{x.content}</p>
      <p className="text-xs text-muted-foreground">{m.fields.confidence} {number(x.confidence, { maximumFractionDigits: 2 })} · {day(x.createdAt)} · {x.sourceApplication}</p>
      {extra}
    </div>
  );
  return (
    <Section
      title={m.sections.conflicts}
      intro={c.intro}
      actions={
        <select className={input} value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          {(['open', 'resolved', 'all'] as const).map((k) => <option key={k} value={k}>{c.show[k]}</option>)}
        </select>
      }
    >
      {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
      {message && <Notice tone="error">{message}</Notice>}
      {data && !data.conflicts.length && <p className="text-sm text-muted-foreground py-6 text-center">{c.empty}</p>}
      <ul className="space-y-3">
        {data?.conflicts.map((k) => (
          <li key={k.id}>
            <Box>
              <div className="flex flex-wrap items-center gap-2">
                <Pill>{(c.kinds as Record<string, string>)[k.kind]}</Pill>
                {k.similarity !== null && <Pill>{fmt(c.similarity, { value: number(k.similarity, { maximumFractionDigits: 2 }) })}</Pill>}
                <Pill>{fmt(c.detectedBy, { by: k.detectedBy })}</Pill>
                <Pill>{fmt(c.recommended, { action: (c.resolutions as Record<string, string>)[k.recommended] ?? k.recommended })}</Pill>
                {k.resolution && <Pill>{fmt(c.resolvedAs, { resolution: (c.resolutions as Record<string, string>)[k.resolution] ?? k.resolution })}</Pill>}
              </div>
              {k.explanation && <p className="text-sm text-foreground">{k.explanation}</p>}
              <div className="grid md:grid-cols-2 gap-3">
                {side(`${c.existing} · ${k.existing.namespacePath}`, k.existing, k.existing.isLocked && <Pill>{m.fields.locked}</Pill>)}
                {k.proposed && side(c.proposed, k.proposed, k.proposed.evidence && <p className="text-xs text-muted-foreground">“{k.proposed.evidence}”</p>)}
              </div>
              {k.existing.isLocked && k.status !== 'Resolved' && <Notice tone="warn">{c.lockedWarning}</Notice>}
              {k.status !== 'Resolved' && (
                <>
                  <Field label={c.mergedText}>
                    <textarea className={`${input} min-h-14`} value={merged[k.id] ?? ''} onChange={(e) => setMerged({ ...merged, [k.id]: e.target.value })} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={r === k.recommended ? primary : r === 'reject' ? danger : btn}
                        disabled={k.existing.isLocked && ['replace', 'merge', 'supersede'].includes(r)}
                        onClick={() => void resolve(k.id, r)}
                      >
                        {c.resolutions[r]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Box>
          </li>
        ))}
      </ul>
    </Section>
  );
}
