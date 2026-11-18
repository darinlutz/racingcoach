'use client';

import { ArrowDownUp, Archive, BrainCircuit, Copy, Download, GitCompare, Pencil, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { InspectionBadge, Notice, Panel, ParseBadge, SourceBadge } from '@/components/SetupBadges';
import SetupParameterTable from '@/components/SetupParameterTable';
import type { RevisionChoice } from '@/components/SetupRevisionPicker';
import { jsonInit, setupsRequest, type RevisionDetail, type SetupDetailResponse, type SetupSummary } from '@/lib/setupClient';

type Actions = {
  compare: (a: RevisionChoice, b: RevisionChoice) => void;
  askEngineer: (choice: RevisionChoice) => void;
  reload: () => Promise<void>;
};

type SortKey = 'name' | 'car' | 'track' | 'source' | 'inspection' | 'updatedAt';

// My Setups: the user's setup library (a searchable, sortable table with filters), .sto uploads and one setup's details
export default function SetupLibrary({
  setups,
  openSetupId,
  onOpenSetup,
  uploadRequest,
  editRequest,
  canUseEngineer,
  actions,
}: {
  setups: SetupSummary[];
  openSetupId: number | null;
  onOpenSetup: (id: number | null) => void;
  uploadRequest: number;
  editRequest: number;
  canUseEngineer: boolean;
  actions: Actions;
}) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups;
  const l = s.library;
  const [search, setSearch] = useState('');
  const [car, setCar] = useState('');
  const [track, setTrack] = useState('');
  const [source, setSource] = useState('');
  const [inspection, setInspection] = useState('');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'updatedAt', desc: true });
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The Overview's Import Setup opens the file picker
  useEffect(() => {
    if (uploadRequest > 0) fileInput.current?.click();
  }, [uploadRequest]);

  const cars = useMemo(() => [...new Set(setups.map((x) => x.car).filter(Boolean) as string[])].sort(), [setups]);
  const tracks = useMemo(() => [...new Set(setups.map((x) => x.track).filter(Boolean) as string[])].sort(), [setups]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = setups.filter(
      (x) =>
        (archived || !x.archived) &&
        (!needle || [x.name, x.fileName, x.car, x.track, x.notes].some((v) => v?.toLowerCase().includes(needle))) &&
        (!car || x.car === car) &&
        (!track || x.track === track) &&
        (!source || x.source === source) &&
        (!inspection || x.inspection === inspection)
    );
    const value = (x: SetupSummary) => (sort.key === 'updatedAt' ? x.updatedAt : String(x[sort.key] ?? ''));
    return filtered.sort((a, b) => value(a).localeCompare(value(b)) * (sort.desc ? -1 : 1));
  }, [setups, search, car, track, source, inspection, archived, sort]);

  const upload = async (file: File) => {
    setUploading(true);
    setMessage(null);
    const form = new FormData();
    form.append('file', file);
    const res = await setupsRequest<{ setupId: number; duplicate: boolean }>('/api/setups', { method: 'POST', body: form });
    setUploading(false);
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.error || s.errors.failed });
      return;
    }
    setMessage({ tone: 'ok', text: fmt(res.data.duplicate ? l.alreadyUploaded : l.uploaded, { name: file.name }) });
    await actions.reload();
    onOpenSetup(res.data.setupId);
  };

  const toggleSelected = (id: number) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current.slice(-1), id]));
  const choiceOf = (id: number): RevisionChoice => {
    const x = setups.find((y) => y.id === id);
    return x?.latestRevisionId ? { setupId: x.id, revisionId: x.latestRevisionId } : null;
  };

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 font-semibold">
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key === 'updatedAt' }))}
      >
        {label}
        {sort.key === key && <ArrowDownUp className="size-3" aria-hidden />}
      </button>
    </th>
  );
  const select = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground';

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={l.search} aria-label={l.search} className={`${select} min-w-48 flex-1`} />
          <select className={select} value={car} onChange={(e) => setCar(e.target.value)} aria-label={s.common.car}>
            <option value="">{l.allCars}</option>
            {cars.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className={select} value={track} onChange={(e) => setTrack(e.target.value)} aria-label={s.common.track}>
            <option value="">{l.allTracks}</option>
            {tracks.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className={select} value={source} onChange={(e) => setSource(e.target.value)} aria-label={s.common.source}>
            <option value="">{l.allSources}</option>
            {(['sdk', 'sto', 'generated'] as const).map((c) => (
              <option key={c} value={c}>
                {s.sources[c]}
              </option>
            ))}
          </select>
          <select className={select} value={inspection} onChange={(e) => setInspection(e.target.value)} aria-label={l.columns.inspection}>
            <option value="">{l.allInspections}</option>
            {(['passed', 'failed', 'unknown', 'notChecked'] as const).map((c) => (
              <option key={c} value={c}>
                {s.inspection[c]}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {l.showArchived}
          </label>
          <div className="ml-auto flex gap-2">
            {selected.length === 2 && (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:border-primary" onClick={() => actions.compare(choiceOf(selected[0]), choiceOf(selected[1]))}>
                <GitCompare className="size-4" aria-hidden />
                {l.compare}
              </button>
            )}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
            >
              <Upload className="size-4" aria-hidden />
              {uploading ? l.uploading : l.upload}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".sto"
              className="hidden"
              data-no-track
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file);
              }}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{l.uploadHelp}</p>
        {message && (
          <div className="mt-3">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </Panel>

      {setups.length === 0 ? (
        <Notice>{s.common.noSetups}</Notice>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2">
                  <span className="sr-only">{l.selectedForCompare}</span>
                </th>
                {header('name', l.columns.setup)}
                {header('car', l.columns.car)}
                {header('track', l.columns.track)}
                {header('source', l.columns.source)}
                {header('inspection', l.columns.inspection)}
                {header('updatedAt', l.columns.modified)}
                <th className="px-3 py-2 font-semibold">{l.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className={`border-t border-border ${x.id === openSetupId ? 'bg-secondary' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={l.selectedForCompare} disabled={!x.latestRevisionId} checked={selected.includes(x.id)} onChange={() => toggleSelected(x.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => onOpenSetup(x.id)}>
                      {x.name}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {x.valueCount ? plural(x.valueCount, l.values, { count: x.valueCount }) : l.noValues}
                      {x.archived && ` · ${l.archived}`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-foreground">{x.car ?? <span className="text-muted-foreground">{s.common.unknown}</span>}</td>
                  <td className="px-3 py-2 text-foreground">{x.track ?? <span className="text-muted-foreground">{s.common.notSet}</span>}</td>
                  <td className="px-3 py-2">
                    <SourceBadge source={x.source} />
                  </td>
                  <td className="px-3 py-2">
                    <InspectionBadge result={x.inspection} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <LocalTime iso={x.updatedAt} format="relative" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button type="button" title={l.details} aria-label={l.details} className="rounded p-1 hover:bg-secondary" onClick={() => onOpenSetup(x.id)}>
                        <Pencil className="size-4" />
                      </button>
                      {x.hasFile && (
                        <a href={`/api/setups/${x.id}/file`} title={l.download} aria-label={l.download} className="rounded p-1 hover:bg-secondary">
                          <Download className="size-4" />
                        </a>
                      )}
                      {canUseEngineer && x.latestRevisionId && (
                        <button type="button" title={l.sendToEngineer} aria-label={l.sendToEngineer} className="rounded p-1 hover:bg-secondary" onClick={() => actions.askEngineer(choiceOf(x.id))}>
                          <BrainCircuit className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openSetupId && (
        <SetupDetails key={openSetupId} setupId={openSetupId} editRequest={editRequest} canUseEngineer={canUseEngineer} onClose={() => onOpenSetup(null)} actions={actions} />
      )}
    </div>
  );
}

function SetupDetails({
  setupId,
  editRequest,
  canUseEngineer,
  onClose,
  actions,
}: {
  setupId: number;
  editRequest: number;
  canUseEngineer: boolean;
  onClose: () => void;
  actions: Actions;
}) {
  const { t, fmt, number } = useLanguage();
  const s = t.setups;
  const l = s.library;
  const [detail, setDetail] = useState<SetupDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', notes: '', car: '', track: '' });
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<RevisionDetail | null>(null);
  const [editing, setEditing] = useState(editRequest > 0);

  const load = async () => {
    const res = await setupsRequest<SetupDetailResponse>(`/api/setups/${setupId}`);
    if (!res.ok) {
      setError(res.error || s.errors.notFound);
      return;
    }
    setDetail(res.data);
    setViewing(res.data.setup.latest);
    const x = res.data.setup;
    setForm({ name: x.name, notes: x.notes, car: x.car ?? '', track: x.track ?? '' });
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the setup's details when another is opened
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!detail) return <p className="text-muted-foreground">{s.common.loading}</p>;
  const setup = detail.setup;

  const save = async () => {
    setSaving('saving');
    const res = await setupsRequest('/api/setups/' + setupId, jsonInit('PATCH', { name: form.name, notes: form.notes, car: form.car || null, track: form.track || null }));
    setSaving(res.ok ? 'saved' : 'idle');
    if (!res.ok) setError(res.error || s.errors.failed);
    await actions.reload();
  };
  const patch = async (body: object) => {
    const res = await setupsRequest('/api/setups/' + setupId, jsonInit('PATCH', body));
    if (!res.ok) setError(res.error || s.errors.failed);
    await Promise.all([load(), actions.reload()]);
  };
  const duplicate = async () => {
    const res = await setupsRequest<{ setupId: number }>(`/api/setups/${setupId}/duplicate`, jsonInit('POST', { name: fmt(l.duplicateName, { name: setup.name }) }));
    if (!res.ok) setError(res.error || s.errors.failed);
    await actions.reload();
  };
  const remove = async () => {
    setConfirmDelete(false);
    const res = await setupsRequest('/api/setups/' + setupId, { method: 'DELETE' });
    if (!res.ok) return setError(res.error || s.errors.failed);
    await actions.reload();
    onClose();
  };
  const openRevision = async (id: number) => {
    const res = await setupsRequest<{ revision: RevisionDetail }>(`/api/setups/revisions/${id}`);
    if (res.ok) setViewing(res.data.revision);
  };
  const input = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground';
  const button = 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:border-primary';
  const latestChoice: RevisionChoice = setup.latestRevisionId ? { setupId, revisionId: setup.latestRevisionId } : null;

  return (
    <Panel
      title={setup.name}
      actions={
        <button type="button" onClick={onClose} aria-label={s.library.cancel} className="rounded p-1 hover:bg-secondary">
          <X className="size-4" />
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <SourceBadge source={setup.source} />
        <ParseBadge status={setup.parseStatus} />
        <InspectionBadge result={setup.inspection} />
        {setup.fileName && <span className="text-muted-foreground">{setup.fileName}</span>}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{s.parseStatusHelp[setup.parseStatus]}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="font-semibold text-foreground">{l.rename}</span>
            <input className={input} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-semibold text-foreground">{s.common.car}</span>
              <input className={input} value={form.car} maxLength={200} onChange={(e) => setForm({ ...form, car: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-foreground">{s.common.track}</span>
              <input className={input} value={form.track} maxLength={200} onChange={(e) => setForm({ ...form, track: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-semibold text-foreground">{l.notes}</span>
            <textarea className={`${input} min-h-20`} value={form.notes} maxLength={4000} placeholder={l.notesPlaceholder} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong" onClick={() => void save()}>
              {saving === 'saving' ? s.common.loading : saving === 'saved' ? l.saved : l.save}
            </button>
            <button type="button" className={button} onClick={() => void duplicate()}>
              <Copy className="size-4" aria-hidden />
              {l.duplicate}
            </button>
            <button type="button" className={button} onClick={() => void patch({ archived: !setup.archived })}>
              <Archive className="size-4" aria-hidden />
              {setup.archived ? l.unarchive : l.archive}
            </button>
            {setup.hasFile && (
              <a className={button} href={`/api/setups/${setupId}/file`}>
                <Download className="size-4" aria-hidden />
                {l.download}
              </a>
            )}
            {canUseEngineer && latestChoice && (
              <button type="button" className={button} onClick={() => actions.askEngineer(latestChoice)}>
                <BrainCircuit className="size-4" aria-hidden />
                {l.sendToEngineer}
              </button>
            )}
            <button type="button" className={`${button} text-bad-text`} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden />
              {l.delete}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {setup.stoInfo && (
            <div className="rounded-lg border border-border bg-secondary p-3 text-sm">
              <div className="font-semibold text-foreground">{l.fileDetails}</div>
              <div className="text-muted-foreground">
                {fmt(l.fileSize, { size: number(setup.stoInfo.fileBytes / 1024, { maximumFractionDigits: 1 }), version: setup.stoInfo.containerVersion ?? '?' })}
              </div>
              {setup.stoNotes && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-primary">{l.fileNotes}</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">{setup.stoNotes}</pre>
                </details>
              )}
            </div>
          )}
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">{l.revisionsTitle}</div>
            {setup.revisionList.length === 0 ? (
              <p className="text-sm text-muted-foreground">{l.noValues}</p>
            ) : (
              <ul className="max-h-56 divide-y divide-border overflow-auto rounded-lg border border-border text-sm">
                {setup.revisionList.map((r) => (
                  <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 ${viewing?.id === r.id ? 'bg-secondary' : ''}`}>
                    <button type="button" className="text-left text-primary hover:underline" onClick={() => void openRevision(r.id)}>
                      {fmt(s.common.revision, { number: r.number })} · {s.revisionKinds[r.kind]}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      <LocalTime iso={r.createdAt} format="relative" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {viewing && viewing.parameters.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-foreground">
              {fmt(s.common.revision, { number: viewing.number })} · {s.revisionKinds[viewing.kind]}
            </h4>
            {viewing.id === setup.latestRevisionId && !editing && (
              <button type="button" className={button} onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                {s.overview.createRevision}
              </button>
            )}
          </div>
          {editing && viewing.id === setup.latestRevisionId ? (
            <RevisionEditor
              revision={viewing}
              onDone={async (made) => {
                setEditing(false);
                await Promise.all([load(), actions.reload()]);
                if (made) setViewing(made);
              }}
            />
          ) : (
            <SetupParameterTable parameters={viewing.parameters} sourceLabel={viewing.kind === 'capture' ? s.live.sourceSdk : s.revisionKinds[viewing.kind]} />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={fmt(l.deleteConfirm, { name: setup.name })}
        confirmLabel={l.delete}
        cancelLabel={l.cancel}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Panel>
  );
}

// Changing values of the latest revision by hand: a new revision, the original kept
function RevisionEditor({ revision, onDone }: { revision: RevisionDetail; onDone: (made: RevisionDetail | null) => Promise<void> }) {
  const { t, fmt } = useLanguage();
  const e = t.setups.revisionEditor;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
  const changes = revision.parameters
    .filter((p) => edits[p.path] !== undefined && edits[p.path].trim() !== '' && Number(edits[p.path]) !== p.value && Number.isFinite(Number(edits[p.path])))
    .map((p) => ({ path: p.path, value: Number(edits[p.path]) }));
  const create = async () => {
    if (!changes.length) return setState({ busy: false, error: e.nothing });
    setState({ busy: true, error: '' });
    const res = await setupsRequest<{ revision: RevisionDetail }>(`/api/setups/revisions/${revision.id}`, jsonInit('POST', { action: 'change', changes, summary }));
    if (!res.ok) return setState({ busy: false, error: res.error || t.setups.errors.failed });
    setState({ busy: false, error: '' });
    await onDone(res.data.revision);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{e.help}</p>
      <SetupParameterTable parameters={revision.parameters} sourceLabel={t.setups.revisionKinds[revision.kind]} edits={edits} onEdit={(path, value) => setEdits({ ...edits, [path]: value })} />
      <label className="block text-sm">
        <span className="font-semibold text-foreground">{e.summary}</span>
        <input className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={summary} maxLength={300} onChange={(ev) => setSummary(ev.target.value)} />
      </label>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex gap-2">
        <button type="button" disabled={state.busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60" onClick={() => void create()}>
          {state.busy ? e.creating : e.create}
          {changes.length > 0 && ` (${changes.length})`}
        </button>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => void onDone(null)}>
          {t.setups.library.cancel}
        </button>
      </div>
      <span className="sr-only">{fmt(e.created, { number: revision.number + 1 })}</span>
    </div>
  );
}
