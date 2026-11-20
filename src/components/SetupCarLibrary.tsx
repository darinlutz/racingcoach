'use client';

import { Download, Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { Notice, Panel } from '@/components/SetupBadges';
import type { LibraryCar, LibraryImport, LibrarySetup } from '@/lib/carSetupLibrary';
import { CAR_SETUP_PROVENANCES, type CarSetupProvenance } from '@/lib/carSetupLibraryRules';
import { fmt } from '@/lib/i18n/languages';
import { jsonInit, setupsRequest } from '@/lib/setupClient';
import type { HtmParameter, ParsedSetupHtm } from '@/lib/setupHtm';
import { SETUP_CATEGORIES } from '@/lib/setupYaml';

// The Setups page's iRacing Setups tab (docs/setups.md's iRacing setup collection), Admins only: the setups the
// collector's Get Car Setups imported, by car, with their files, the values read from each .htm export (in the
// Setups page's categories, under iRacing's own labels and units) and downloads of the original files, streamed
// through /api/setups/car-library/[id]/file after its Admin check. Every row is a database record.

type ListResponse = { cars: LibraryCar[]; setups: LibrarySetup[]; imports: LibraryImport[] };
type DetailResponse = { setup: LibrarySetup & { parsed: ParsedSetupHtm | null; stoNotes: string | null } };

export default function SetupCarLibrary() {
  const { t } = useLanguage();
  const s = t.setups;
  const c = s.carSetups;
  const [data, setData] = useState<ListResponse | null>(null);
  const [car, setCar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(
    async (folder: string | null) => {
      const res = await setupsRequest<ListResponse>(`/api/setups/car-library${folder ? `?car=${encodeURIComponent(folder)}` : ''}`);
      if (!res.ok) {
        setError(c.loadFailed);
        return;
      }
      setError(null);
      // Opens on the first car with setups
      if (!folder && res.data.cars.length) {
        setCar(res.data.cars[0].carFolder);
        return;
      }
      setData(res.data);
    },
    [c.loadFailed]
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the picked car's setups
    void load(car);
  }, [load, car]);

  const setProvenance = async (id: number, provenance: CarSetupProvenance) => {
    const res = await setupsRequest(`/api/setups/car-library/${id}`, jsonInit('PATCH', { provenance }));
    if (!res.ok) setError(c.saveFailed);
    else void load(car);
  };

  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-muted-foreground">{s.common.loading}</p>;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{c.intro}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {data.cars.length === 0 ? (
        <Notice>{c.noCars}</Notice>
      ) : (
        <Panel
          actions={
            <label className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-foreground">{c.car}</span>
              <select
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                value={car ?? ''}
                onChange={(e) => {
                  setOpenId(null);
                  setCar(e.target.value);
                }}
                data-track="car-setups-car"
              >
                {data.cars.map((x) => (
                  <option key={x.carFolder} value={x.carFolder}>
                    {x.carName} ({x.setups})
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {data.setups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{c.noSetups}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">{c.columns.setup}</th>
                    <th className="py-2 pr-3">{c.columns.sto}</th>
                    <th className="py-2 pr-3">{c.columns.htm}</th>
                    <th className="py-2 pr-3">{c.columns.imported}</th>
                    <th className="py-2 pr-3">{c.columns.origin}</th>
                    <th className="py-2">{c.columns.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.setups.map((setup) => (
                    <SetupRow
                      key={setup.id}
                      setup={setup}
                      open={openId === setup.id}
                      onToggle={() => setOpenId(openId === setup.id ? null : setup.id)}
                      onProvenance={(p) => void setProvenance(setup.id, p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      {openId !== null && <SetupDetails id={openId} />}
      {data.imports.length > 0 && <ImportList imports={data.imports} />}
    </div>
  );
}

function SetupRow({ setup, open, onToggle, onProvenance }: { setup: LibrarySetup; open: boolean; onToggle: () => void; onProvenance: (p: CarSetupProvenance) => void }) {
  const { t } = useLanguage();
  const c = t.setups.carSetups;
  const link = 'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:border-primary hover:text-primary';
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="py-2 pr-3">
        <div className="font-semibold text-foreground">{setup.setupPath}</div>
        <div className="text-xs text-muted-foreground">{fmt(c.version, { version: setup.version })}</div>
      </td>
      <td className="py-2 pr-3 text-good-text">{c.available}</td>
      <td className="py-2 pr-3">
        {setup.htmFileName ? <span className="text-good-text">{c.available}</span> : <span className="text-muted-foreground">{c.notAvailable}</span>}
        <div className="text-xs text-muted-foreground">{c.htmStatus[setup.htmParseStatus as keyof typeof c.htmStatus] ?? setup.htmParseStatus}</div>
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        <LocalTime iso={setup.updatedAt} format="dateTime" />
      </td>
      <td className="py-2 pr-3">
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          value={setup.provenance}
          title={c.provenanceHelp}
          onChange={(e) => onProvenance(e.target.value as CarSetupProvenance)}
          data-track="car-setups-provenance"
        >
          {CAR_SETUP_PROVENANCES.map((p) => (
            <option key={p} value={p}>
              {c.provenance[p]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1.5">
          <button className={link} onClick={onToggle} data-track="car-setups-view">
            {open ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {open ? c.hide : c.view}
          </button>
          <a className={link} href={`/api/setups/car-library/${setup.id}/file?kind=sto`} data-track="car-setups-download-sto">
            <Download className="size-3.5" aria-hidden />
            {c.downloadSto}
          </a>
          {setup.htmFileName && (
            <a className={link} href={`/api/setups/car-library/${setup.id}/file?kind=htm`} data-track="car-setups-download-htm">
              <Download className="size-3.5" aria-hidden />
              {c.downloadHtm}
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

function SetupDetails({ id }: { id: number }) {
  const { t } = useLanguage();
  const s = t.setups;
  const c = s.carSetups;
  const [detail, setDetail] = useState<DetailResponse['setup'] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void setupsRequest<DetailResponse>(`/api/setups/car-library/${id}`).then((res) => {
      if (!live) return;
      if (res.ok) setDetail(res.data.setup);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (failed) return <Notice tone="error">{c.loadFailed}</Notice>;
  if (!detail) return <p className="text-muted-foreground">{s.common.loading}</p>;
  const parsed = detail.parsed;
  const byCategory = SETUP_CATEGORIES.map((category) => ({ category, rows: (parsed?.parameters ?? []).filter((p) => p.category === category) })).filter(
    (g) => g.rows.length > 0
  );
  const boxNotes = (parsed?.sections ?? []).filter((x) => x.description.length);

  return (
    <Panel title={fmt(c.details.title, { name: detail.setupPath })}>
      <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {parsed?.carPath && (
          <>
            <dt className="text-muted-foreground">{c.details.exportCar}</dt>
            <dd className="text-foreground">{parsed.carPath}</dd>
          </>
        )}
        {parsed?.track && (
          <>
            <dt className="text-muted-foreground">{c.details.exportTrack}</dt>
            <dd className="text-foreground">{parsed.track}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{c.details.files}</dt>
        <dd className="space-y-0.5 font-mono text-xs text-foreground">
          <div>
            {detail.stoFileName} · {fmt(c.details.bytes, { bytes: detail.stoBytes })} · {c.details.sha} {detail.stoSha256}
          </div>
          {detail.htmFileName && (
            <div>
              {detail.htmFileName} · {fmt(c.details.bytes, { bytes: detail.htmBytes ?? 0 })} · {c.details.sha} {detail.htmSha256}
            </div>
          )}
        </dd>
      </dl>
      {!detail.htmFileName && <Notice>{c.details.unavailable}</Notice>}
      {detail.htmFileName && parsed?.status === 'failed' && <Notice tone="error">{c.details.failed}</Notice>}
      {detail.htmFileName && parsed?.status === 'empty' && <Notice>{c.details.empty}</Notice>}
      <div className="space-y-5">
        {byCategory.map(({ category, rows }) => (
          <section key={category}>
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-foreground">{s.categories[category]}</h4>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">{c.details.box}</th>
                    <th className="py-1.5 pr-3 font-semibold">{c.details.setting}</th>
                    <th className="py-1.5 font-semibold">{c.details.value}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <ParameterRow key={p.path} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {boxNotes.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-foreground">{c.details.boxNotes}</h4>
            {boxNotes.map((x) => (
              <p key={x.index} className="mb-2 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{x.title}: </span>
                {x.description.join(' ')}
              </p>
            ))}
          </section>
        )}
        {(parsed?.notes || detail.stoNotes) && (
          <section>
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-foreground">{c.details.setupNotes}</h4>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{parsed?.notes || detail.stoNotes}</p>
          </section>
        )}
        {parsed && parsed.warnings.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-semibold">{c.details.warnings} ({parsed.warnings.length})</summary>
            <ul className="mt-1 list-disc pl-5 font-mono">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

function ParameterRow({ p }: { p: HtmParameter }) {
  const { t } = useLanguage();
  const c = t.setups.carSetups;
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-3 text-muted-foreground">{p.section}</td>
      <td className="py-1.5 pr-3 text-foreground">
        {p.label}
        {p.kind === 'reading' && (
          <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-info-text" title={c.details.readingHelp}>
            {c.details.reading}
          </span>
        )}
        {p.inCar && <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{c.details.inCar}</span>}
      </td>
      <td className="py-1.5 font-mono text-foreground">{p.raw}</td>
    </tr>
  );
}

function ImportList({ imports }: { imports: LibraryImport[] }) {
  const { t } = useLanguage();
  const c = t.setups.carSetups;
  return (
    <Panel title={c.imports.title}>
      <ul className="space-y-3 text-sm">
        {imports.map((run) => (
          <li key={run.id} className="border-b border-border/60 pb-3 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{c.imports.status[run.status as keyof typeof c.imports.status] ?? run.status}</span>
              <span className="text-muted-foreground">
                <LocalTime iso={run.startedAt} format="dateTime" />
              </span>
              <span className="text-muted-foreground">{run.carFolders.join(', ')}</span>
            </div>
            <div className="text-muted-foreground">
              {fmt(c.imports.counts, { found: run.setupsFound, new: run.newCount, changed: run.changedCount, unchanged: run.unchangedCount, failed: run.failedCount })}
            </div>
            {run.unresolved.length > 0 && (
              <div className="text-bad-text">{fmt(c.imports.unresolved, { folders: run.unresolved.map((u) => u.folder).join(', ') })}</div>
            )}
            {run.errors.length > 0 && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer font-semibold text-bad-text">
                  {c.imports.failures} ({run.errors.length})
                </summary>
                <ul className="mt-1 list-disc pl-5 font-mono text-muted-foreground">
                  {run.errors.map((e, i) => (
                    <li key={i}>
                      {e.path}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
