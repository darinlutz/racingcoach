'use client';

import { useCallback, useEffect, useState } from 'react';
import { CarViewDebugProvider, CarViewProvider } from '@/components/CarViewContext';
import EngineeringCarView from '@/components/EngineeringCarView';
import { useConfirm } from '@/components/ConfirmProvider';
import { useLanguage } from '@/components/LanguageProvider';
import type { AssetAction, AssetStatus, ResolvedCarAsset } from '@/lib/carViews/assetRules';
import { genericSources } from '@/lib/carViews/genericVehicle';
import { SVG_LIMITS } from '@/lib/carViews/svgSanitize';
import { CAR_VIEWS, type CarView } from '@/lib/carViews/views';

// The Admin page's Engineering Car Drawings (docs/car-views.md): every car's drawing versions with their status and
// review history, a new version's five views (an SVG file and its anchors each), sources, licence and approximations,
// and a preview of any version with the SVG debug mode's anchors on. GET/POST /api/admin/car-views and
// GET/PUT/DELETE /api/admin/car-views/[id], Admins only.

type Summary = {
  id: number;
  carId: number;
  carName: string;
  version: number;
  status: AssetStatus;
  active: boolean;
  carKeys: string[];
  views: CarView[];
  sources: string;
  license: string;
  notes: string;
  history: { action: string; from: string | null; to: string | null; at: string }[];
};
type ViewDraft = { svg: string; fileName: string; anchors: string; hasWheels: boolean };
type Bundled = { id: string; carName: string; carKeys: string[]; views: CarView[]; credit: string; license: string; suggestedCarId: number | null };

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1';
const buttonClass = 'rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-50';

const emptyViews = (): Record<CarView, ViewDraft> =>
  Object.fromEntries(CAR_VIEWS.map((v) => [v, { svg: '', fileName: '', anchors: '', hasWheels: true }])) as Record<CarView, ViewDraft>;

const ACTIONS_BY_STATUS: Record<AssetStatus, AssetAction[]> = {
  draft: ['submit'],
  under_review: ['approve', 'reject'],
  approved: ['activate'],
  rejected: [],
};

export default function CarViewAssetManager() {
  const { t, fmt } = useLanguage();
  const ask = useConfirm();
  const c = t.setups.carViews;
  const s = c.admin;
  const [cars, setCars] = useState<{ id: number; name: string }[]>([]);
  const [assets, setAssets] = useState<Summary[] | null>(null);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [carId, setCarId] = useState('');
  const [carKeys, setCarKeys] = useState('');
  const [views, setViews] = useState(emptyViews);
  const [sources, setSources] = useState('');
  const [license, setLicense] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<ResolvedCarAsset | null>(null);
  const [bundled, setBundled] = useState<Bundled[]>([]);
  const [bundledCar, setBundledCar] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [res, bundledRes] = await Promise.all([fetch('/api/admin/car-views'), fetch('/api/admin/car-views/bundled')]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCars(data.cars);
      setAssets(data.assets);
      const b = await bundledRes.json().catch(() => ({}));
      if (bundledRes.ok && Array.isArray(b.drawings)) {
        setBundled(b.drawings);
        setBundledCar((current) => ({
          ...Object.fromEntries((b.drawings as Bundled[]).map((d) => [d.id, d.suggestedCarId ? String(d.suggestedCarId) : ''])),
          ...current,
        }));
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : c.errors.failed);
    }
  }, [c.errors.failed]);

  // Imports one of the repository's drawing sets as a new draft version of the chosen car
  const importBundled = async (drawing: Bundled) => {
    setError('');
    setProblems([]);
    setMessage('');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/car-views/bundled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: drawing.id, carId: Number(bundledCar[drawing.id]) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || c.errors.failed);
        setProblems(Array.isArray(data.problems) ? data.problems : []);
        return;
      }
      await load();
      setMessage(fmt(s.imported, { version: data.version }));
    } catch {
      setError(c.errors.failed);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once
    void load();
  }, [load]);

  const setView = (view: CarView, change: Partial<ViewDraft>) => setViews((v) => ({ ...v, [view]: { ...v[view], ...change } }));

  const readFile = async (view: CarView, file: File | undefined) => {
    setError('');
    if (!file) return setView(view, { svg: '', fileName: '' });
    if (file.size > SVG_LIMITS.bytes) return setError(s.fileTooLarge);
    try {
      setView(view, { svg: await file.text(), fileName: file.name });
    } catch {
      setError(s.readFailed);
    }
  };

  const save = async () => {
    setError('');
    setProblems([]);
    setMessage('');
    const body: Record<string, unknown> = { carId: Number(carId), carKeys: carKeys.split(/[,\s]+/).filter(Boolean), sources, license, notes, views: {} };
    for (const view of CAR_VIEWS) {
      const v = views[view];
      if (!v.svg) continue;
      let anchors: unknown = {};
      try {
        anchors = v.anchors.trim() ? JSON.parse(v.anchors) : {};
      } catch {
        return setError(`${c.views[view]}: ${s.anchorsJson}`);
      }
      (body.views as Record<string, unknown>)[view] = { svg: v.svg, anchors, hasWheels: v.hasWheels };
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/car-views', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || c.errors.failed);
        setProblems(Array.isArray(data.problems) ? data.problems : []);
        return;
      }
      await load();
      setMessage(fmt(s.saved, { version: data.version }));
      setViews(emptyViews());
    } catch {
      setError(c.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const act = async (asset: Summary, action: AssetAction | 'delete') => {
    if (action === 'delete' && !(await ask.confirm({ message: fmt(s.confirmDelete, { version: asset.version }), action: 'delete' }))) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/car-views/${asset.id}`, {
        method: action === 'delete' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || c.errors.failed);
      if (preview?.id === asset.id) setPreview(null);
      await load();
    } catch {
      setError(c.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async (asset: Summary) => {
    if (preview?.id === asset.id) return setPreview(null);
    setError('');
    try {
      const res = await fetch(`/api/admin/car-views/${asset.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data.asset);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : c.errors.failed);
    }
  };

  return (
    <div id="engineering-car-drawings" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{s.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{s.intro}</p>
      </div>
      {error && (
        <div className="text-sm text-red-500" role="alert">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && <p className="text-sm text-good-text">{message}</p>}

      {bundled.length > 0 && (
        <section className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-foreground">{s.bundledTitle}</h3>
            <p className="text-sm text-muted-foreground">{s.bundledIntro}</p>
          </div>
          <ul className="divide-y divide-border">
            {bundled.map((drawing) => (
              <li key={drawing.id} className="grid gap-2 py-3 text-sm text-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] md:items-center">
                <div className="min-w-0">
                  <strong>{drawing.carName}</strong>{' '}
                  <span className="text-xs text-muted-foreground">
                    · {fmt(s.viewsCount, { count: drawing.views.length })} · <span className="font-mono">{drawing.carKeys.join(', ')}</span>
                  </span>
                  <p className="truncate text-xs text-muted-foreground" title={`${drawing.credit} · ${drawing.license}`}>
                    {drawing.credit} · {drawing.license}
                  </p>
                </div>
                <select
                  aria-label={`${s.car}: ${drawing.carName}`}
                  value={bundledCar[drawing.id] ?? ''}
                  onChange={(e) => setBundledCar((v) => ({ ...v, [drawing.id]: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">{s.pickCar}</option>
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !bundledCar[drawing.id]}
                  onClick={() => void importBundled(drawing)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
                >
                  {s.importDraft}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border p-4 space-y-4">
        <h3 className="font-semibold text-foreground">{s.newVersion}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ecv-car" className={labelClass}>
              {s.car}
            </label>
            <select id="ecv-car" value={carId} onChange={(e) => setCarId(e.target.value)} className={inputClass}>
              <option value="">{s.pickCar}</option>
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ecv-keys" className={labelClass}>
              {s.carKeys}
            </label>
            <input id="ecv-keys" value={carKeys} onChange={(e) => setCarKeys(e.target.value)} placeholder="lamborghinievogt3" className={inputClass} />
            <p className="mt-1 text-xs text-muted-foreground">{s.carKeysHelp}</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {CAR_VIEWS.map((view) => (
            <fieldset key={view} className="rounded-lg border border-border p-3 space-y-2">
              <legend className="px-1 text-sm font-semibold capitalize text-foreground">{c.views[view]}</legend>
              <div>
                <label htmlFor={`ecv-svg-${view}`} className={labelClass}>
                  {s.drawing}
                </label>
                <input id={`ecv-svg-${view}`} type="file" accept=".svg,image/svg+xml" onChange={(e) => void readFile(view, e.target.files?.[0])} className="text-sm text-foreground" />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`ecv-anchors-${view}`} className={labelClass}>
                    {s.anchors}
                  </label>
                  <button type="button" className={buttonClass} onClick={() => setView(view, { anchors: JSON.stringify(genericSources()[view].anchors, null, 2) })}>
                    {s.useTemplate}
                  </button>
                </div>
                <textarea
                  id={`ecv-anchors-${view}`}
                  value={views[view].anchors}
                  onChange={(e) => setView(view, { anchors: e.target.value })}
                  rows={4}
                  spellCheck={false}
                  className={`${inputClass} font-mono text-xs`}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={views[view].hasWheels} onChange={(e) => setView(view, { hasWheels: e.target.checked })} />
                {s.hasWheels}
              </label>
            </fieldset>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {(
            [
              ['sources', sources, setSources, s.sources, s.sourcesHelp],
              ['license', license, setLicense, s.license, s.licenseHelp],
              ['notes', notes, setNotes, s.notes, s.notesHelp],
            ] as const
          ).map(([key, value, set, label, help]) => (
            <div key={key}>
              <label htmlFor={`ecv-${key}`} className={labelClass}>
                {label}
              </label>
              <textarea id={`ecv-${key}`} value={value} onChange={(e) => set(e.target.value)} rows={3} className={inputClass} />
              <p className="mt-1 text-xs text-muted-foreground">{help}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !carId}
          onClick={() => void save()}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
        >
          {busy ? s.saving : s.saveDraft}
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">{s.versions}</h3>
        {!assets ? (
          <p className="text-sm text-muted-foreground">{s.loading}</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.none}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {assets.map((asset) => (
              <li key={asset.id} className="space-y-2 px-4 py-3 text-sm text-foreground">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong>{asset.carName}</strong>
                  <span className="font-mono">{fmt(s.version, { version: asset.version })}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-xs">{s.status[asset.status]}</span>
                  {asset.active && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">{s.active}</span>}
                  <span className="text-xs text-muted-foreground">
                    {fmt(s.coverage, { count: asset.views.length })} · {asset.views.map((v) => c.views[v]).join(', ')}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{asset.carKeys.join(', ')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} onClick={() => void showPreview(asset)}>
                    {preview?.id === asset.id ? s.actions.hidePreview : s.actions.preview}
                  </button>
                  {ACTIONS_BY_STATUS[asset.status]
                    .filter((a) => !(a === 'activate' && asset.active))
                    .map((action) => (
                      <button key={action} type="button" disabled={busy} className={buttonClass} onClick={() => void act(asset, action)}>
                        {s.actions[action]}
                      </button>
                    ))}
                  {asset.active && (
                    <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(asset, 'deactivate')}>
                      {s.actions.deactivate}
                    </button>
                  )}
                  {!asset.active && (asset.status === 'draft' || asset.status === 'rejected') && (
                    <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(asset, 'delete')}>
                      {s.actions.delete}
                    </button>
                  )}
                </div>
                {asset.history.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {s.history}:{' '}
                    {asset.history
                      .map((h) => `${h.action === 'create' ? s.status.draft : (s.actions[h.action as AssetAction] ?? h.action)} (${new Date(h.at).toLocaleString()})`)
                      .join(' · ')}
                  </p>
                )}
                {preview?.id === asset.id && (
                  <div className="space-y-2 rounded-lg border border-border p-3 align-grid">
                    <p className="text-xs font-semibold text-foreground">{fmt(s.previewTitle, { car: asset.carName, version: asset.version })}</p>
                    <CarViewProvider carKey={null} asset={preview}>
                      <CarViewDebugProvider on>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {CAR_VIEWS.map((view) => (
                            <div key={view}>
                              <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.views[view]}</div>
                              <EngineeringCarView view={view} className={view === 'top' ? 'mx-auto h-72 w-full' : 'h-40 w-full'} />
                            </div>
                          ))}
                        </div>
                      </CarViewDebugProvider>
                    </CarViewProvider>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
