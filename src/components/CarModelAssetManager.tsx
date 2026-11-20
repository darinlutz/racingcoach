'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Car3DViewerLazy from '@/components/car3d/Car3DViewerLazy';
import { useLanguage } from '@/components/LanguageProvider';
import { AXES, canonicalBounds, dimensions, validAxes, type Axis, type Bounds, type Normalization, type Vec3 } from '@/lib/carModels/matrix';
import {
  anchorGeometry,
  CAMERA_VIEWS,
  CORNERS,
  editableStatus,
  estimateWheelAnchors,
  modelFileUrl,
  nonCommercial,
  type CameraView,
  type ModelAction,
  type ModelStatus,
  type ResolvedCarModel,
  type WheelAnchors,
} from '@/lib/carModels/modelRules';

// The Admin page's 3D Car Models (docs/car-models.md), beside Engineering Car Drawings: every Car Data car and whether
// it has a model, an upload form, and every version with its status, review history and a preview. The preview is the
// same viewer drivers get (Car3DViewer), with the canonical axes, the model's box and its wheel-center rings, and
// while the version is uploaded or rejected its normalization, wheel centers, opening camera and provenance can be
// changed and seen at once, then saved. Every version has a Delete button (the active one too, after a warning that the
// car then shows the generic car). GET/POST /api/admin/car-models, GET/PUT/DELETE /api/admin/car-models/[id],
// Admins only.

type Car = { id: number; name: string; lengthIn: number | null; widthIn: number | null; wheelbaseIn: number | null };
type Summary = {
  id: number;
  carId: number;
  carName: string;
  version: number;
  status: ModelStatus;
  active: boolean;
  carKeys: string[];
  fileName: string;
  bytes: number;
  sha256: string;
  stats: { triangles: number; meshes: number; textures: number };
  warnings: { code: string; detail?: string }[];
  rawBounds: Bounds;
  normalization: Normalization;
  wheelAnchors: WheelAnchors;
  defaultView: CameraView;
  source: string;
  license: string;
  attribution: string;
  notes: string;
  history: { action: string; from: string | null; to: string | null; at: string }[];
};
type Draft = {
  normalization: Normalization;
  wheelAnchors: WheelAnchors;
  defaultView: CameraView;
  carKeys: string;
  source: string;
  license: string;
  attribution: string;
  notes: string;
};

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const smallInput = 'w-full px-2 py-1 bg-card border border-border rounded text-foreground text-xs font-mono focus:outline-none focus:border-primary';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1';
const buttonClass = 'rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

const ACTIONS_BY_STATUS: Record<ModelStatus, ModelAction[]> = {
  uploaded: ['submit'],
  ready_for_review: ['approve', 'reject'],
  approved: ['activate'],
  rejected: [],
};
const INCH = 0.0254;
const meters = (v: number) => `${v.toFixed(3)} m`;
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const draftOf = (s: Summary): Draft => ({
  normalization: s.normalization,
  wheelAnchors: s.wheelAnchors,
  defaultView: s.defaultView,
  carKeys: s.carKeys.join(', '),
  source: s.source,
  license: s.license,
  attribution: s.attribution,
  notes: s.notes,
});

export default function CarModelAssetManager() {
  const { t, fmt } = useLanguage();
  const m = t.setups.carModels;
  const s = m.admin;
  const [cars, setCars] = useState<Car[]>([]);
  const [models, setModels] = useState<Summary[] | null>(null);
  const [storage, setStorage] = useState(true);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'withModel' | 'missing'>('all');
  const [carId, setCarId] = useState('');
  const [carKeys, setCarKeys] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInput, setFileInput] = useState(0);
  const [source, setSource] = useState('');
  const [license, setLicense] = useState('');
  const [attribution, setAttribution] = useState('');
  const [notes, setNotes] = useState('');
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [corner, setCorner] = useState<(typeof CORNERS)[number]>('LF');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/car-models');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCars(data.cars);
      setModels(data.models);
      setStorage(data.storageConfigured);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : m.errors.failed);
    }
  }, [m.errors.failed]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once
    void load();
  }, [load]);

  const fail = (data: { error?: string; problems?: string[] }) => {
    setError(data.error || m.errors.failed);
    setProblems(Array.isArray(data.problems) ? data.problems : []);
  };
  const clear = () => {
    setError('');
    setProblems([]);
    setMessage('');
  };

  // Each car's best status: Active, else its newest version's, else Missing
  const byCar = useMemo(() => {
    const map = new Map<number, Summary[]>();
    for (const model of models ?? []) map.set(model.carId, [...(map.get(model.carId) ?? []), model]);
    return map;
  }, [models]);
  const carStatus = (id: number): string => {
    const versions = byCar.get(id);
    if (!versions?.length) return s.status.missing;
    const active = versions.find((v) => v.active);
    return active ? `${s.active} v${active.version}` : `${s.status[versions[0].status]} v${versions[0].version}`;
  };
  const shownCars = cars.filter((c) => (filter === 'all' ? true : filter === 'missing' ? !byCar.has(c.id) : byCar.has(c.id)));
  const activeCount = (models ?? []).filter((v) => v.active).length;

  const upload = async () => {
    clear();
    if (!file) return setError(m.problems.file);
    const form = new FormData();
    form.set('carId', carId);
    form.set('carKeys', carKeys);
    form.set('source', source);
    form.set('license', license);
    form.set('attribution', attribution);
    form.set('notes', notes);
    form.set('file', file);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/car-models', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return fail(data);
      await load();
      setMessage(fmt(s.uploaded, { version: data.version }));
      setFile(null);
      setFileInput((k) => k + 1);
      setPreviewId(data.id);
      setDraft(null);
    } catch {
      setError(m.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const act = async (model: Summary, action: ModelAction | 'delete') => {
    if (action === 'delete' && !window.confirm(fmt(model.active ? s.confirmDeleteActive : s.confirmDelete, { version: model.version, car: model.carName }))) return;
    clear();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/car-models/${model.id}`, {
        method: action === 'delete' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) fail(data);
      else if (action === 'delete') {
        if (previewId === model.id) setPreviewId(null);
        setMessage(fmt(s.deleted, { car: model.carName, version: model.version }));
      }
      await load();
    } catch {
      setError(m.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const preview = models?.find((v) => v.id === previewId) ?? null;
  // The draft follows the version being previewed until it's edited
  const current: Draft | null = preview ? (draft ?? draftOf(preview)) : null;
  const editable = !!preview && editableStatus(preview.status);
  const change = (patch: Partial<Draft>) => current && setDraft({ ...current, ...patch });
  const setN = (patch: Partial<Normalization>) => current && change({ normalization: { ...current.normalization, ...patch } });

  const save = async () => {
    if (!preview || !current) return;
    clear();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/car-models/${preview.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            normalization: current.normalization,
            wheelAnchors: current.wheelAnchors,
            defaultView: current.defaultView,
            carKeys: current.carKeys,
            source: current.source,
            license: current.license,
            attribution: current.attribution,
            notes: current.notes,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return fail(data);
      setDraft(null);
      await load();
      setMessage(s.saved);
    } catch {
      setError(m.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  // What the viewer shows: the version as it would be with the draft's settings (the saved orientation while the draft's
  // up and forward are the same axis, which can't be drawn)
  const shownN = current && preview && validAxes(current.normalization.up, current.normalization.forward) && current.normalization.scale > 0 ? current.normalization : preview?.normalization;
  const previewModel: ResolvedCarModel | null =
    preview && current
      ? {
          id: preview.id,
          version: preview.version,
          carId: preview.carId,
          carName: preview.carName,
          status: preview.status,
          active: preview.active,
          url: modelFileUrl(preview.id, preview.sha256),
          bytes: preview.bytes,
          normalization: shownN!,
          rawBounds: preview.rawBounds,
          wheelAnchors: current.wheelAnchors,
          defaultView: current.defaultView,
          attribution: current.attribution,
          license: current.license,
        }
      : null;

  const previewCar = preview ? cars.find((c) => c.id === preview.carId) : undefined;
  const dims = preview && shownN ? dimensions(canonicalBounds(shownN, preview.rawBounds)) : null;
  const geometry = current ? anchorGeometry(current.wheelAnchors) : null;
  const carLength = previewCar?.lengthIn ? previewCar.lengthIn * INCH : null;
  const mismatch = dims && carLength ? (dims.length - carLength) / carLength : null;

  return (
    <div id="car-models" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{s.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{s.intro}</p>
      </div>
      {!storage && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">{s.storageMissing}</p>}
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

      {/* Every car and whether it has a model */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-semibold text-foreground">
          {s.cars} · <span className="text-sm font-normal text-muted-foreground">{fmt(s.carsSummary, { withModel: byCar.size, total: cars.length, active: activeCount })}</span>
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['all', 'withModel', 'missing'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={`${buttonClass} ${filter === f ? 'border-primary text-primary' : ''}`} onClick={() => setFilter(f)}>
              {s.filter[f]}
            </button>
          ))}
        </div>
        <ul className="mt-3 grid max-h-72 gap-x-6 overflow-y-auto text-sm sm:grid-cols-2 lg:grid-cols-3">
          {shownCars.map((car) => (
            <li key={car.id} className="flex items-center justify-between gap-2 border-b border-border py-1">
              <span className="truncate text-foreground">{car.name}</span>
              <span className={`shrink-0 text-xs ${byCar.has(car.id) ? 'text-primary' : 'text-muted-foreground'}`}>{carStatus(car.id)}</span>
            </li>
          ))}
        </ul>
      </details>

      {/* A new version */}
      <section className="rounded-lg border border-border p-4 space-y-4">
        <h3 className="font-semibold text-foreground">{s.upload}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="cm-car" className={labelClass}>
              {s.car}
            </label>
            <select id="cm-car" value={carId} onChange={(e) => setCarId(e.target.value)} className={inputClass}>
              <option value="">{s.pickCar}</option>
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cm-keys" className={labelClass}>
              {s.carKeys}
            </label>
            <input id="cm-keys" value={carKeys} onChange={(e) => setCarKeys(e.target.value)} placeholder="lamborghinievogt3" className={inputClass} />
            <p className="mt-1 text-xs text-muted-foreground">{s.carKeysHelp}</p>
          </div>
          <div>
            <label htmlFor="cm-file" className={labelClass}>
              {s.file}
            </label>
            <input key={fileInput} id="cm-file" type="file" accept=".glb,model/gltf-binary" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">{s.fileHelp}</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          {(
            [
              ['source', source, setSource, s.source, s.sourceHelp],
              ['license', license, setLicense, s.license, s.licenseHelp],
              ['attribution', attribution, setAttribution, s.attribution, s.attributionHelp],
              ['notes', notes, setNotes, s.notes, s.notesHelp],
            ] as const
          ).map(([key, value, set, label, help]) => (
            <div key={key}>
              <label htmlFor={`cm-${key}`} className={labelClass}>
                {label}
              </label>
              <textarea id={`cm-${key}`} value={value} onChange={(e) => set(e.target.value)} rows={3} className={inputClass} />
              <p className="mt-1 text-xs text-muted-foreground">{help}</p>
            </div>
          ))}
        </div>
        <button type="button" disabled={busy || !carId || !file || !storage} onClick={() => void upload()} className={primaryClass}>
          {busy ? s.uploading : s.uploadButton}
        </button>
      </section>

      {/* The versions */}
      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">{s.versions}</h3>
        {!models ? (
          <p className="text-sm text-muted-foreground">{s.loading}</p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.none}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {models.map((model) => (
              <li key={model.id} className="space-y-2 px-4 py-3 text-sm text-foreground">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong>{model.carName}</strong>
                  <span className="font-mono">{fmt(s.version, { version: model.version })}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-xs">{s.status[model.status]}</span>
                  {model.active && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">{s.active}</span>}
                  <span className="font-mono text-xs text-muted-foreground">{model.carKeys.join(', ')}</span>
                  {model.fileName && <span className="text-xs text-muted-foreground">{model.fileName}</span>}
                  <span className="text-xs text-muted-foreground">
                    {fmt(s.stats, {
                      triangles: model.stats.triangles.toLocaleString(),
                      meshes: model.stats.meshes,
                      textures: model.stats.textures,
                      size: megabytes(model.bytes),
                    })}
                  </span>
                </div>
                {nonCommercial(model.license) && <p className="text-xs text-amber-600 dark:text-amber-400">{s.nonCommercial}</p>}
                {model.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {fmt(s.warnings[w.code as keyof typeof s.warnings] ?? w.code, { detail: w.detail ?? '' })}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      setPreviewId(previewId === model.id ? null : model.id);
                      setDraft(null);
                    }}
                  >
                    {previewId === model.id ? s.actions.hidePreview : s.actions.preview}
                  </button>
                  {ACTIONS_BY_STATUS[model.status]
                    .filter((a) => !(a === 'activate' && model.active))
                    .map((action) => (
                      <button key={action} type="button" disabled={busy} className={buttonClass} onClick={() => void act(model, action)}>
                        {s.actions[action]}
                      </button>
                    ))}
                  {model.active && (
                    <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(model, 'deactivate')}>
                      {s.actions.deactivate}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className={`${buttonClass} text-red-500 hover:border-red-500`}
                    onClick={() => void act(model, 'delete')}
                  >
                    {s.actions.delete}
                  </button>
                </div>
                {model.history.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {s.history}:{' '}
                    {model.history
                      .map((h) => {
                        const name =
                          s.historyActions[h.action as keyof typeof s.historyActions] ?? s.actions[h.action as ModelAction] ?? h.action;
                        return `${name} (${new Date(h.at).toLocaleString()})`;
                      })
                      .join(' · ')}
                  </p>
                )}

                {previewId === model.id && previewModel && current && (
                  <div className="grid gap-4 rounded-lg border border-border p-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs font-semibold text-foreground">{fmt(s.previewTitle, { car: model.carName, version: model.version })}</p>
                      <Car3DViewerLazy preview={previewModel} selectedCorner={corner} onSelectCorner={setCorner} showAxes showBounds height={440} />
                      {dims && (
                        <p className="text-xs text-muted-foreground">
                          {fmt(s.dimensions, { length: meters(dims.length), width: meters(dims.width), height: meters(dims.height) })}
                          {' · '}
                          {previewCar?.lengthIn
                            ? fmt(s.carData, {
                                length: meters(previewCar.lengthIn * INCH),
                                width: previewCar.widthIn ? meters(previewCar.widthIn * INCH) : '–',
                                wheelbase: previewCar.wheelbaseIn ? meters(previewCar.wheelbaseIn * INCH) : '–',
                              })
                            : s.noCarData}
                        </p>
                      )}
                      {mismatch !== null && Math.abs(mismatch) > 0.05 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {fmt(s.mismatch, { percent: Math.round(Math.abs(mismatch) * 100), direction: mismatch > 0 ? s.longer : s.shorter })}
                        </p>
                      )}
                      {geometry && (
                        <p className="text-xs text-muted-foreground">
                          {fmt(s.geometry, { wheelbase: meters(geometry.wheelbase), front: meters(geometry.frontTrack), rear: meters(geometry.rearTrack) })}
                        </p>
                      )}
                    </div>

                    <fieldset disabled={!editable || busy} className="space-y-3 text-xs">
                      {!editable && <p className="text-muted-foreground">{s.editLocked}</p>}
                      <div>
                        <p className="font-semibold text-foreground">{s.normalization}</p>
                        <p className="text-muted-foreground">{s.normalizationHelp}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(['up', 'forward'] as const).map((key) => (
                          <label key={key}>
                            <span className={labelClass}>{s[key]}</span>
                            <select value={current.normalization[key]} onChange={(e) => setN({ [key]: e.target.value as Axis })} className={smallInput}>
                              {AXES.map((a) => (
                                <option key={a} value={a}>
                                  {a}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                        <label>
                          <span className={labelClass}>{s.scale}</span>
                          <input type="number" step="0.001" min="0.000001" value={current.normalization.scale} onChange={(e) => setN({ scale: Number(e.target.value) || 0 })} className={smallInput} />
                        </label>
                        <label>
                          <span className={labelClass}>{s.yaw}</span>
                          <input type="number" step="0.5" value={current.normalization.yaw} onChange={(e) => setN({ yaw: Number(e.target.value) || 0 })} className={smallInput} />
                        </label>
                      </div>
                      <div>
                        <span className={labelClass}>{s.offset}</span>
                        <div className="grid grid-cols-3 gap-2">
                          {[0, 1, 2].map((k) => (
                            <input
                              key={k}
                              type="number"
                              step="0.01"
                              aria-label={`${s.offset} ${'xyz'[k]}`}
                              value={current.normalization.offset[k]}
                              onChange={(e) => {
                                const offset = [...current.normalization.offset] as Vec3;
                                offset[k] = Number(e.target.value) || 0;
                                setN({ offset });
                              }}
                              className={smallInput}
                            />
                          ))}
                        </div>
                      </div>
                      <label className="block">
                        <span className={labelClass}>{s.defaultView}</span>
                        <select value={current.defaultView} onChange={(e) => change({ defaultView: e.target.value as CameraView })} className={smallInput}>
                          {CAMERA_VIEWS.map((v) => (
                            <option key={v} value={v}>
                              {m.views[v]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={labelClass}>{s.wheelAnchors}</span>
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() =>
                              change({
                                wheelAnchors: estimateWheelAnchors(
                                  canonicalBounds(shownN!, preview!.rawBounds),
                                  previewCar?.wheelbaseIn ? previewCar.wheelbaseIn * INCH : null
                                ),
                              })
                            }
                          >
                            {s.estimate}
                          </button>
                        </div>
                        <p className="mb-1 text-muted-foreground">{s.wheelAnchorsHelp}</p>
                        {CORNERS.map((c) => (
                          <div key={c} className="mb-1 grid grid-cols-[2.5rem_1fr_1fr_1fr_auto] items-center gap-1">
                            <span className="font-mono font-semibold text-foreground">{c}</span>
                            {(['x', 'y', 'z'] as const).map((axis) => (
                              <input
                                key={axis}
                                type="number"
                                step="0.005"
                                aria-label={`${c} ${axis}`}
                                value={current.wheelAnchors[c][axis]}
                                onFocus={() => setCorner(c)}
                                onChange={(e) =>
                                  change({ wheelAnchors: { ...current.wheelAnchors, [c]: { ...current.wheelAnchors[c], [axis]: Number(e.target.value) || 0 } } })
                                }
                                className={smallInput}
                              />
                            ))}
                            <label className="inline-flex items-center gap-1 text-muted-foreground" title={s.verified}>
                              <input
                                type="checkbox"
                                checked={current.wheelAnchors[c].verified}
                                onChange={(e) => change({ wheelAnchors: { ...current.wheelAnchors, [c]: { ...current.wheelAnchors[c], verified: e.target.checked } } })}
                              />
                              ✓
                            </label>
                          </div>
                        ))}
                      </div>
                      <label className="block">
                        <span className={labelClass}>{s.carKeys}</span>
                        <input value={current.carKeys} onChange={(e) => change({ carKeys: e.target.value })} className={smallInput} />
                      </label>
                      {(['source', 'license', 'attribution', 'notes'] as const).map((key) => (
                        <label key={key} className="block">
                          <span className={labelClass}>{s[key]}</span>
                          <textarea value={current[key]} onChange={(e) => change({ [key]: e.target.value })} rows={2} className={smallInput} />
                        </label>
                      ))}
                      <button type="button" disabled={!editable || busy || !draft} onClick={() => void save()} className={primaryClass}>
                        {s.actions.save}
                      </button>
                    </fieldset>
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
