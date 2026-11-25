'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Box, btn, Field, input, memApi, ModeSelect, Notice, Pill, primary, Section, Toggle, useErrorText, useMemApi, useReference } from './memoryUi';

// Namespaces as a tree: create children, rename, turn off, set a mode override, mark customer data or an approved
// global. Authorization itself is on the server (resolveNamespaces); this only edits the definitions.

const KINDS = ['personal', 'application', 'project', 'admin', 'organization', 'global', 'experiment'] as const;

export default function MmNamespaces({ openLibrary }: { openLibrary: (namespace: { id: string; path: string }) => void }) {
  const { t, fmt } = useLanguage();
  const m = t.aiLab.memoryManager;
  const n = m.namespaces;
  const errorText = useErrorText();
  const { namespaces, reload } = useReference();
  const [draft, setDraft] = useState({ path: '', name: '', kind: 'project', description: '', isCustomerData: false });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [spaces, setSpaces] = useState<{ id: string; path: string; memoryCount: number }[] | null>(null);
  const summary = useMemApi<{ userSpaces?: number }>('/namespaces');
  const lookup = async () => {
    setMessage(null);
    try {
      setSpaces((await memApi<{ namespaces: { id: string; path: string; memoryCount: number }[] }>(`/namespaces?user=${encodeURIComponent(lookupId)}`)).namespaces);
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  };

  const call = async (work: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await work();
      await reload();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    }
  };
  const update = (id: string, body: Record<string, unknown>) => call(() => memApi(`/namespaces/${id}`, { method: 'PATCH', body }));

  return (
    <Section title={m.sections.namespaces} intro={n.intro}>
      {message && <Notice tone={message.tone === 'ok' ? 'ok' : 'error'}>{message.text}</Notice>}
      <Box title={n.add}>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label={n.path} hint={n.pathHint}><input className={input} value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value.toLowerCase() })} /></Field>
          <Field label={n.name}><input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label={n.kind}>
            <select className={input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k} value={k}>{n.kinds[k]}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <button type="button" className={primary} disabled={!draft.path || !draft.name} onClick={() => void call(() => memApi('/namespaces', { body: draft }).then(() => setDraft({ path: '', name: '', kind: 'project', description: '', isCustomerData: false })))}>{m.common.create}</button>
          </div>
        </div>
        <Toggle checked={draft.isCustomerData} onChange={(v) => setDraft({ ...draft, isCustomerData: v })} label={n.customer} hint={n.customerHint} />
      </Box>
      <Box title={n.userSpaces}>
        <p className="text-sm text-muted-foreground">{n.userSpacesIntro}</p>
        {summary.data?.userSpaces !== undefined && <p className="text-sm text-foreground">{fmt(n.userCount, { count: summary.data.userSpaces })}</p>}
        <div className="flex items-end gap-2">
          <Field label={n.userId}><input className={input} inputMode="numeric" value={lookupId} onChange={(e) => setLookupId(e.target.value.replace(/\D/g, ''))} /></Field>
          <button type="button" className={btn} disabled={!lookupId} onClick={() => void lookup()}>{n.lookup}</button>
        </div>
        {spaces && !spaces.length && <p className="text-sm text-muted-foreground">{n.noSpaces}</p>}
        <ul className="space-y-1">
          {spaces?.map((x) => (
            <li key={x.id} className="flex items-center gap-2 text-sm">
              <span className="text-foreground">{x.path}</span>
              <Pill>{fmt(n.count, { count: x.memoryCount })}</Pill>
              <button type="button" className={btn} onClick={() => openLibrary(x)}>{n.openLibrary}</button>
            </li>
          ))}
        </ul>
      </Box>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {namespaces.map((x) => {
          const depth = x.path.split('/').length - 1;
          return (
            <div key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2" style={{ paddingLeft: `${12 + depth * 20}px` }}>
              <div className="min-w-48 flex-1">
                <div className="font-medium text-foreground">{x.name} <span className="text-xs text-muted-foreground">{x.path}</span></div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Pill>{n.kinds[x.kind as keyof typeof n.kinds] ?? x.kind}</Pill>
                  {x.isCustomerData && <Pill>{n.customer}</Pill>}
                  {x.globalApproved && <Pill>{n.globalApproved}</Pill>}
                  <Pill>{fmt(n.count, { count: x.memoryCount })}</Pill>
                </div>
              </div>
              <div className="w-64"><ModeSelect value={x.mode} onChange={(v) => void update(x.id, { mode: v })} allowNone /></div>
              <Toggle checked={x.enabled} onChange={(v) => void update(x.id, { enabled: v })} label={n.enabled} />
              <Toggle checked={x.isCustomerData} onChange={(v) => void update(x.id, { isCustomerData: v })} label={n.customer} />
              {x.kind === 'global' && <Toggle checked={x.globalApproved} onChange={(v) => void update(x.id, { globalApproved: v })} label={n.globalApproved} />}
              <button type="button" className={btn} onClick={() => { const name = window.prompt(n.name, x.name); if (name) void update(x.id, { name }); }}>{m.common.edit}</button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
