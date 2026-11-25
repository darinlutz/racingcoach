'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { btn, input, Pill, Section, useMemApi, when } from './memoryUi';

// Audit History: every memory change, decision and setting change, filtered by action

type Entry = { id: number; at: string; requestId: string | null; actor: string | null; action: string; target: string | null; outcome: string; detail: unknown };

export default function MmAudit() {
  const { t } = useLanguage();
  const m = t.aiLab.memoryManager;
  const a = m.audit;
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, reload } = useMemApi<{ entries: Entry[] }>(`/audit?limit=100&offset=${offset}${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section title={m.sections.audit} intro={a.intro} actions={<button type="button" className={btn} onClick={() => void reload()}>{m.common.refresh}</button>}>
      <input className={`${input} max-w-xs`} placeholder={a.filterAction} aria-label={a.filterAction} value={action} onChange={(e) => (setAction(e.target.value), setOffset(0))} />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr><th className="text-left py-2 px-3">{a.at}</th><th className="text-left py-2 px-3">{a.actor}</th><th className="text-left py-2 px-3">{a.action}</th><th className="text-left py-2 px-3">{a.target}</th><th className="text-left py-2 px-3">{a.outcome}</th></tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id} className="border-t border-border align-top cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <td className="py-1.5 px-3 text-xs whitespace-nowrap">{when(e.at)}</td>
                <td className="py-1.5 px-3">{e.actor ?? a.system}</td>
                <td className="py-1.5 px-3 font-mono text-xs">{e.action}{open === e.id && e.detail ? <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{JSON.stringify(e.detail, null, 2)}</pre> : null}</td>
                <td className="py-1.5 px-3 text-xs break-all">{e.target}</td>
                <td className="py-1.5 px-3"><Pill>{e.outcome}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.entries.length && <p className="text-sm text-muted-foreground text-center py-6">{a.empty}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>{m.common.previous}</button>
        <button type="button" className={btn} disabled={(data?.entries.length ?? 0) < 100} onClick={() => setOffset(offset + 100)}>{m.common.next}</button>
      </div>
    </Section>
  );
}
