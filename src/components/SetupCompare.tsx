'use client';

import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Notice, Panel } from '@/components/SetupBadges';
import SetupRevisionPicker, { type RevisionChoice } from '@/components/SetupRevisionPicker';
import { formatDifference } from '@/lib/setupCompare';
import { lapTime, setupsRequest, type CompareResponse, type CompareRow, type LapsSummary } from '@/lib/setupClient';
import { keyLabel, SETUP_CATEGORIES } from '@/lib/setupYaml';

const CORNERS = ['LeftFront', 'RightFront', 'LeftRear', 'RightRear'] as const;

// Compare: two revisions side by side by parameter path (setupCompare.ts), grouped by subsystem, the differences
// charted, each corner of the car drawn with what changed there, and the laps driven on each when they're known
export default function SetupCompare({
  setups,
  value,
  onChange,
}: {
  setups: Parameters<typeof SetupRevisionPicker>[0]['setups'];
  value: { a: RevisionChoice; b: RevisionChoice };
  onChange: (value: { a: RevisionChoice; b: RevisionChoice }) => void;
}) {
  const { t, plural } = useLanguage();
  const s = t.setups;
  const c = s.compare;
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [showReadings, setShowReadings] = useState(false);

  useEffect(() => {
    const a = value.a?.revisionId;
    const b = value.b?.revisionId;
    if (!a || !b) return;
    let live = true;
    void setupsRequest<CompareResponse>(`/api/setups/compare?a=${a}&b=${b}`).then((res) => {
      if (!live) return;
      if (res.ok) {
        setData(res.data);
        setError('');
      } else setError(res.error || s.errors.failed);
    });
    return () => {
      live = false;
    };
  }, [value.a?.revisionId, value.b?.revisionId, s.errors.failed]);

  const current = data && data.baseline.id === value.a?.revisionId && data.comparison.id === value.b?.revisionId ? data : null;
  const rows = useMemo(
    () => (current?.result.rows ?? []).filter((r) => (showReadings || r.kind === 'setting') && (!onlyDiff || r.status !== 'same')),
    [current, onlyDiff, showReadings]
  );
  const differences = current ? current.result.rows.filter((r) => r.status !== 'same' && (showReadings || r.kind === 'setting')).length : 0;

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
          <SetupRevisionPicker label={c.baseline} setups={setups} value={value.a} onChange={(a) => onChange({ ...value, a })} />
          <button
            type="button"
            onClick={() => onChange({ a: value.b, b: value.a })}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:border-primary"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            {c.swap}
          </button>
          <SetupRevisionPicker label={c.comparison} setups={setups} value={value.b} onChange={(b) => onChange({ ...value, b })} />
        </div>
      </Panel>

      {!value.a || !value.b ? (
        <Notice>{c.pickBoth}</Notice>
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : !current ? (
        <p className="text-muted-foreground">{s.common.loading}</p>
      ) : !current.result.compatible ? (
        <Notice tone="error">{c.incompatible}</Notice>
      ) : current.baseline.valueCount === 0 || current.comparison.valueCount === 0 ? (
        <Notice>{c.noValues}</Notice>
      ) : (
        <>
          <LapsPanel baseline={current.laps.baseline} comparison={current.laps.comparison} names={[current.baseline.setup.name, current.comparison.setup.name]} />
          <VisualComparison rows={current.result.rows.filter((r) => r.kind === 'setting')} />
          <Panel
            title={plural(differences, c.differences, { count: differences })}
            actions={
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                  {c.onlyDifferences}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={showReadings} onChange={(e) => setShowReadings(e.target.checked)} />
                  {s.common.showReadings}
                </label>
              </div>
            }
          >
            <CompareTable rows={rows} />
          </Panel>
        </>
      )}
    </div>
  );
}

function statusText(row: CompareRow, c: ReturnType<typeof useLanguage>['t']['setups']['compare']): string {
  if (row.status === 'onlyBaseline') return c.onlyBaseline;
  if (row.status === 'onlyComparison') return c.onlyComparison;
  if (row.status === 'notComparable') return c.notComparable;
  if (row.status === 'changed' && row.difference == null) return c.textChanged;
  return '';
}

function CompareTable({ rows }: { rows: CompareRow[] }) {
  const { t } = useLanguage();
  const s = t.setups;
  const grouped = SETUP_CATEGORIES.map((category) => [category, rows.filter((r) => r.category === category)] as const).filter(([, list]) => list.length);
  if (!grouped.length) return <p className="text-sm text-muted-foreground">{s.compare.noNumeric}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">{s.common.parameter}</th>
            <th className="px-3 py-2 text-right font-semibold">{s.compare.baseline}</th>
            <th className="px-3 py-2 text-right font-semibold">{s.compare.comparison}</th>
            <th className="px-3 py-2 text-right font-semibold">{s.compare.difference}</th>
          </tr>
        </thead>
        {grouped.map(([category, list]) => (
          <tbody key={category}>
            <tr>
              <th colSpan={4} className="bg-secondary px-3 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-foreground">
                {s.categories[category]}
              </th>
            </tr>
            {list.map((r) => {
              const changed = r.status !== 'same';
              const tone = r.difference == null ? 'text-info-text' : r.difference > 0 ? 'text-tele-pos' : 'text-tele-neg';
              return (
                <tr key={r.path} className={`border-t border-border ${changed ? 'bg-primary/5' : ''}`} title={r.path}>
                  <td className="px-3 py-1.5 text-foreground">
                    <span className="text-muted-foreground">{[r.section, r.group].filter(Boolean).map((x) => keyLabel(x!)).join(' › ')} › </span>
                    {keyLabel(r.key)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.baseline ?? '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${changed ? 'font-semibold text-foreground' : ''}`}>{r.comparison ?? '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${changed ? tone : 'text-muted-foreground'}`}>
                    {r.difference != null ? formatDifference(r.difference, r.differenceUnit) : statusText(r, s.compare)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

// The differences charted: each subsystem's numeric differences as bars either side of zero, as a share of the
// baseline's value, and the four corners of the car with what changed at each
function VisualComparison({ rows }: { rows: CompareRow[] }) {
  const { t } = useLanguage();
  const s = t.setups;
  const numeric = rows.filter((r) => r.difference != null && r.relative != null && r.difference !== 0);
  const max = Math.max(0.0001, ...numeric.map((r) => Math.abs(r.relative!)));
  const corners = CORNERS.map((corner) => ({ corner, rows: rows.filter((r) => r.group === corner && r.status !== 'same') }));
  const axles = rows.filter((r) => r.status !== 'same' && !CORNERS.includes(r.group as (typeof CORNERS)[number]));
  return (
    <Panel title={s.compare.visual}>
      <p className="mb-4 text-sm text-muted-foreground">{s.compare.visualHelp}</p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <CarCorners corners={corners} centre={axles} />
        <div className="space-y-4">
          {numeric.length === 0 && <p className="text-sm text-muted-foreground">{s.compare.noNumeric}</p>}
          {SETUP_CATEGORIES.map((category) => {
            const list = numeric.filter((r) => r.category === category);
            if (!list.length) return null;
            return (
              <div key={category}>
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.categories[category]}</div>
                <ul className="space-y-1">
                  {list.map((r) => {
                    const share = Math.abs(r.relative!) / max;
                    const up = r.difference! > 0;
                    return (
                      <li key={r.path} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem] items-center gap-2 text-xs" title={r.path}>
                        <span className="truncate text-foreground">
                          {r.group && CORNERS.includes(r.group as (typeof CORNERS)[number]) ? `${initials(r.group)} ` : ''}
                          {keyLabel(r.key)}
                        </span>
                        <span className="relative h-3 rounded bg-secondary" aria-hidden>
                          <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                          <span
                            className={`absolute inset-y-0 rounded ${up ? 'left-1/2 bg-tele-pos' : 'right-1/2 bg-tele-neg'}`}
                            style={{ width: `${Math.max(2, share * 50)}%` }}
                          />
                        </span>
                        <span className={`text-right font-mono tabular-nums ${up ? 'text-tele-pos' : 'text-tele-neg'}`}>{formatDifference(r.difference!, r.differenceUnit)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

const initials = (corner: string) => corner.replace(/[a-z]/g, '');

// A top view of the car: each corner's changed values beside its wheel, and the rest (axles, in-car) down the middle
function CarCorners({ corners, centre }: { corners: { corner: (typeof CORNERS)[number]; rows: CompareRow[] }[]; centre: CompareRow[] }) {
  const { t } = useLanguage();
  const s = t.setups;
  const cell = (corner: (typeof CORNERS)[number]) => {
    const list = corners.find((c) => c.corner === corner)?.rows ?? [];
    const right = corner.startsWith('Right');
    return (
      <div className={`rounded-lg border border-border bg-secondary p-2 text-xs ${right ? 'text-right' : ''}`}>
        <div className="font-bold text-foreground">{keyLabel(corner)}</div>
        {list.length === 0 ? (
          <div className="text-muted-foreground">—</div>
        ) : (
          list.slice(0, 6).map((r) => (
            <div key={r.path} className="truncate" title={`${r.baseline ?? '—'} → ${r.comparison ?? '—'}`}>
              <span className="text-muted-foreground">{keyLabel(r.key)} </span>
              <span className={`font-mono ${r.difference == null ? 'text-info-text' : r.difference > 0 ? 'text-tele-pos' : 'text-tele-neg'}`}>
                {r.difference != null ? formatDifference(r.difference, r.differenceUnit) : (r.comparison ?? '—')}
              </span>
            </div>
          ))
        )}
      </div>
    );
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_4.5rem_1fr] grid-rows-2 gap-2" role="img" aria-label={s.compare.visual}>
        {cell('LeftFront')}
        <CarBody />
        {cell('RightFront')}
        {cell('LeftRear')}
        {cell('RightRear')}
      </div>
      <div className="rounded-lg border border-dashed border-border p-2 text-xs">
        {centre.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {centre.slice(0, 12).map((r) => (
              <div key={r.path} className="truncate" title={r.path}>
                <span className="text-muted-foreground">{keyLabel(r.group ?? r.section)} › {keyLabel(r.key)} </span>
                <span className={`font-mono ${r.difference == null ? 'text-info-text' : r.difference > 0 ? 'text-tele-pos' : 'text-tele-neg'}`}>
                  {r.difference != null ? formatDifference(r.difference, r.differenceUnit) : (r.comparison ?? '—')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CarBody() {
  return (
    <svg viewBox="0 0 60 140" className="col-start-2 row-span-2 row-start-1 mx-auto h-full w-full text-muted-foreground" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <path d="M18 6 Q30 0 42 6 L48 40 L50 100 Q50 132 30 136 Q10 132 10 100 L12 40 Z" fill="currentColor" opacity="0.35" />
      <rect x="2" y="18" width="9" height="22" rx="3" fill="currentColor" />
      <rect x="49" y="18" width="9" height="22" rx="3" fill="currentColor" />
      <rect x="1" y="96" width="10" height="26" rx="3" fill="currentColor" />
      <rect x="49" y="96" width="10" height="26" rx="3" fill="currentColor" />
      <rect x="20" y="52" width="20" height="26" rx="5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function LapsPanel({ baseline, comparison, names }: { baseline: LapsSummary; comparison: LapsSummary; names: [string, string] }) {
  const { t, fmt } = useLanguage();
  const c = t.setups.compare;
  if (!baseline?.laps && !comparison?.laps) return null;
  const line = (laps: LapsSummary) =>
    laps?.laps
      ? fmt(c.lapsLine, { laps: laps.laps, clean: laps.cleanLaps, best: lapTime(laps.bestSeconds), average: lapTime(laps.averageCleanSeconds) })
      : c.lapsNone;
  return (
    <Panel title={c.laps}>
      <div className="grid gap-3 sm:grid-cols-2">
        {[baseline, comparison].map((laps, i) => (
          <div key={i} className="rounded-lg border border-border bg-secondary p-3 text-sm">
            <div className={`font-semibold ${i === 0 ? 'text-lap-target' : 'text-lap-compare'}`}>{names[i]}</div>
            <div className="text-muted-foreground">{line(laps)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{c.lapsCaveat}</p>
    </Panel>
  );
}
