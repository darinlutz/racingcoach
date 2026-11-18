'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { setupsRequest, type RevisionSummary, type SetupDetailResponse, type SetupSummary } from '@/lib/setupClient';

export type RevisionChoice = { setupId: number; revisionId: number } | null;

// Picks one of the user's setups and one of its revisions (its latest when the setup is picked). Archived setups are
// offered only when already picked
export default function SetupRevisionPicker({
  label,
  setups,
  value,
  onChange,
  noneLabel,
}: {
  label: string;
  setups: SetupSummary[];
  value: RevisionChoice;
  onChange: (choice: RevisionChoice) => void;
  noneLabel?: string;
}) {
  const { t, fmt } = useLanguage();
  const s = t.setups;
  const [revisions, setRevisions] = useState<{ setupId: number; list: RevisionSummary[] } | null>(null);
  const setupId = value?.setupId ?? null;

  useEffect(() => {
    if (!setupId) return;
    let live = true;
    void setupsRequest<SetupDetailResponse>(`/api/setups/${setupId}`).then((res) => {
      if (live && res.ok) setRevisions({ setupId, list: res.data.setup.revisionList });
    });
    return () => {
      live = false;
    };
  }, [setupId]);

  const list = revisions && revisions.setupId === setupId ? revisions.list : [];
  const choices = setups.filter((x) => !x.archived || x.id === setupId);
  const select = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground';
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-sm font-semibold text-foreground">{label}</legend>
      <select
        className={select}
        value={setupId ?? ''}
        aria-label={label}
        onChange={(e) => {
          const picked = setups.find((x) => x.id === Number(e.target.value));
          onChange(picked?.latestRevisionId ? { setupId: picked.id, revisionId: picked.latestRevisionId } : null);
        }}
      >
        <option value="">{noneLabel ?? s.common.selectSetup}</option>
        {choices.map((x) => (
          <option key={x.id} value={x.id} disabled={!x.latestRevisionId}>
            {x.name}
            {x.car ? ` · ${x.car}` : ''}
            {x.latestRevisionId ? '' : ` (${s.library.noValues})`}
          </option>
        ))}
      </select>
      {setupId && list.length > 1 && (
        <select
          className={select}
          value={value?.revisionId ?? ''}
          aria-label={s.common.selectRevision}
          onChange={(e) => onChange({ setupId, revisionId: Number(e.target.value) })}
        >
          {list.map((r) => (
            <option key={r.id} value={r.id}>
              {fmt(s.common.revision, { number: r.number })} · {s.revisionKinds[r.kind]}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}
