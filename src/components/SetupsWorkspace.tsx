'use client';

import { Box, BrainCircuit, Bug, CircleDot, CircleGauge, Cog, Cpu, Crosshair, Fuel, GitCompare, Import, ListTree, Plane, PlusSquare, RadioTower } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CarViewDebugProvider } from '@/components/CarViewContext';
import { useLanguage } from '@/components/LanguageProvider';
import LocalTime from '@/components/LocalTime';
import { InspectionBadge, Notice, Panel } from '@/components/SetupBadges';
import SetupAlignment from '@/components/SetupAlignment';
import SetupBrakes from '@/components/SetupBrakes';
import SetupCarLibrary from '@/components/SetupCarLibrary';
import SetupCompare from '@/components/SetupCompare';
import SetupEngineerChat from '@/components/SetupEngineerChat';
import SetupHistory from '@/components/SetupHistory';
import SetupInspectionTab from '@/components/SetupInspectionTab';
import SetupLibrary from '@/components/SetupLibrary';
import SetupLive from '@/components/SetupLive';
import SetupDashboardTab from '@/components/SetupDashboardTab';
import SetupSuspension from '@/components/SetupSuspension';
import SetupTires from '@/components/SetupTires';
import { isSetupDashboard } from '@/lib/setupDashboards';
import type { RevisionChoice } from '@/components/SetupRevisionPicker';
import { setupsRequest, type SetupsList } from '@/lib/setupClient';
import type { SetupsTab } from '@/lib/setupsTabs';
import { keyLabel } from '@/lib/setupYaml';

// The engineering systems' tabs, shown as their own row under the others, each with its icon
const SYSTEM_ICONS = { alignment: Crosshair, suspension: Box, brakes: CircleGauge, tires: CircleDot, aero: Plane, drivetrain: Cog, fuel: Fuel, electronics: Cpu, other: ListTree };
const SYSTEM_TABS: SetupsTab[] = Object.keys(SYSTEM_ICONS) as SetupsTab[];
// Tabs without the engineering systems' row: none of them is about the two setups Compare has
const NO_SYSTEMS_BAR: SetupsTab[] = ['library', 'carSetups', 'engineer', 'inspection', 'history'];
const DEBUG_KEY = 'setups.drawingDebug';

// The Setups page (src/app/setups/page.tsx; docs/setups.md): one set of tabs over the user's setups. The tabs share the
// library (loaded once, reloaded after a change) and hand each other what to show: a setup to open, two revisions to
// compare, a revision for the Setup Engineer
export default function SetupsWorkspace({
  tabs,
  initialTab,
  canUseEngineer,
  showPricing,
  canDebugDrawings = false,
}: {
  tabs: SetupsTab[];
  initialTab: SetupsTab;
  canUseEngineer: boolean;
  showPricing: boolean;
  // An Admin: offered the engineering drawings' SVG debug mode (docs/car-views.md)
  canDebugDrawings?: boolean;
}) {
  const { t } = useLanguage();
  const s = t.setups;
  const [tab, setTab] = useState<SetupsTab>(initialTab);
  const [debugDrawings, setDebugDrawings] = useState(false);
  useEffect(() => {
    if (!canDebugDrawings) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the Admin's own choice, remembered in this browser
      if (window.localStorage.getItem(DEBUG_KEY) === '1') setDebugDrawings(true);
    } catch {
      // storage unavailable: the switch starts off
    }
  }, [canDebugDrawings]);
  const toggleDebug = (on: boolean) => {
    setDebugDrawings(on);
    try {
      window.localStorage.setItem(DEBUG_KEY, on ? '1' : '0');
    } catch {
      // storage unavailable: the switch lasts until the page is left
    }
  };
  const [list, setList] = useState<SetupsList | null>(null);
  const [error, setError] = useState(false);
  const [openSetupId, setOpenSetupId] = useState<number | null>(null);
  const [compare, setCompare] = useState<{ a: RevisionChoice; b: RevisionChoice }>({ a: null, b: null });
  const [engineerChoice, setEngineerChoice] = useState<RevisionChoice>(null);
  const [uploadRequest, setUploadRequest] = useState(0);
  const [editRequest, setEditRequest] = useState(0);

  const load = useCallback(async () => {
    const res = await setupsRequest<SetupsList>('/api/setups');
    if (res.ok) {
      setList(res.data);
      setError(false);
    } else setError(true);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the library once
    void load();
  }, [load]);

  const go = (next: SetupsTab) => {
    setTab(next);
    window.history.replaceState(null, '', `?tab=${next}`);
  };
  const actions = {
    openSetup: (id: number) => {
      setOpenSetupId(id);
      go('library');
    },
    compare: (a: RevisionChoice, b: RevisionChoice) => {
      setCompare({ a, b });
      go('compare');
    },
    askEngineer: (choice: RevisionChoice) => {
      setEngineerChoice(choice);
      go(tabs.includes('engineer') ? 'engineer' : 'library');
    },
    reload: load,
  };

  const setups = list?.setups ?? [];
  const latestOf = (id: number | undefined): RevisionChoice => {
    const setup = setups.find((x) => x.id === id);
    return setup?.latestRevisionId ? { setupId: setup.id, revisionId: setup.latestRevisionId } : null;
  };

  // The engineering systems: each one dashboard of the two setups Compare has. Under the main tabs, except on a
  // system's own tab, where it goes under the Baseline and Comparison setup box (SetupFocusComparison's systems)
  const systemsBar = (
    <div role="tablist" aria-label={s.tabs.systems} className="mt-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.tabs.systems}</span>
      {tabs
        .filter((name) => SYSTEM_TABS.includes(name))
        .map((name) => {
          const Icon = SYSTEM_ICONS[name as keyof typeof SYSTEM_ICONS];
          return (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => go(name)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === name
                  ? 'border-align-baseline bg-align-baseline/15 text-foreground shadow-[0_0_0_1px_var(--align-baseline)]'
                  : 'border-border text-muted-foreground hover:border-align-baseline hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {s.tabs[name]}
            </button>
          );
        })}
      {canDebugDrawings && (
        <label className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground" title={s.carViews.debug.toggleTitle}>
          <input type="checkbox" checked={debugDrawings} onChange={(e) => toggleDebug(e.target.checked)} data-track="setups-svg-debug" />
          <Bug className="size-3.5" aria-hidden />
          {s.carViews.debug.toggle}
        </label>
      )}
    </div>
  );

  return (
    <>
      <div className="mb-6">
        <div role="tablist" className="flex flex-wrap gap-2 border-b border-border">
          {tabs
            .filter((name) => !SYSTEM_TABS.includes(name))
            .map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => go(name)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  tab === name ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.tabs[name]}
              </button>
            ))}
        </div>
        {/* Under the main tabs on Overview and Live Setup; under the setup selection box on Compare and the systems */}
        {(!list || (!SYSTEM_TABS.includes(tab) && tab !== 'compare')) && !NO_SYSTEMS_BAR.includes(tab) && systemsBar}
      </div>

      {error && !list && (
        <Notice tone="error">
          {s.errors.load}{' '}
          <button className="font-semibold underline" onClick={() => void load()}>
            {s.common.retry}
          </button>
        </Notice>
      )}
      {!list && !error && <p className="text-muted-foreground">{s.common.loading}</p>}

      {list && (
        <CarViewDebugProvider on={canDebugDrawings && debugDrawings}>
        <div role="tabpanel">
          {tab === 'overview' && (
            <SetupOverviewPanel
              list={list}
              onAction={(action) => {
                const latestCapture = list.overview.latestCaptureSetup?.id;
                if (action === 'import') {
                  setUploadRequest((n) => n + 1);
                  go('library');
                } else if (action === 'capture') go('live');
                else if (action === 'compare') actions.compare(latestOf(setups[1]?.id), latestOf(setups[0]?.id));
                else if (action === 'analyze') actions.askEngineer(latestOf(latestCapture ?? setups[0]?.id));
                else if (action === 'revision') {
                  setEditRequest((n) => n + 1);
                  actions.openSetup(latestCapture ?? setups[0]?.id);
                }
              }}
              onOpen={actions.openSetup}
            />
          )}
          {tab === 'library' && (
            <SetupLibrary
              setups={setups}
              openSetupId={openSetupId}
              onOpenSetup={setOpenSetupId}
              uploadRequest={uploadRequest}
              editRequest={editRequest}
              canUseEngineer={tabs.includes('engineer')}
              actions={actions}
            />
          )}
          {tab === 'carSetups' && tabs.includes('carSetups') && <SetupCarLibrary />}
          {tab === 'live' && <SetupLive onOpen={actions.openSetup} onChanged={load} />}
          {tab === 'compare' && (
            <SetupCompare setups={setups} value={compare} onChange={setCompare} systems={systemsBar} />
          )}
          {tab === 'alignment' && (
            <SetupAlignment
              setups={setups}
              value={compare}
              onChange={setCompare}
              engineer={tabs.includes('engineer') ? { canUse: canUseEngineer, showPricing, onRevisionMade: load } : undefined}
              systems={systemsBar}
            />
          )}
          {tab === 'suspension' && (
            <SetupSuspension
              setups={setups}
              value={compare}
              onChange={setCompare}
              engineer={tabs.includes('engineer') ? { canUse: canUseEngineer, showPricing, onRevisionMade: load } : undefined}
              systems={systemsBar}
            />
          )}
          {tab === 'brakes' && (
            <SetupBrakes
              setups={setups}
              value={compare}
              onChange={setCompare}
              engineer={tabs.includes('engineer') ? { canUse: canUseEngineer, showPricing, onRevisionMade: load } : undefined}
              systems={systemsBar}
            />
          )}
          {tab === 'tires' && (
            <SetupTires
              setups={setups}
              value={compare}
              onChange={setCompare}
              engineer={tabs.includes('engineer') ? { canUse: canUseEngineer, showPricing, onRevisionMade: load } : undefined}
              systems={systemsBar}
            />
          )}
          {isSetupDashboard(tab) && (
            <SetupDashboardTab
              dashboard={tab}
              setups={setups}
              value={compare}
              onChange={setCompare}
              engineer={tabs.includes('engineer') ? { canUse: canUseEngineer, showPricing, onRevisionMade: load } : undefined}
              systems={systemsBar}
            />
          )}
          {tab === 'engineer' && (
            <SetupEngineerChat
              setups={setups}
              value={engineerChoice}
              onChange={setEngineerChoice}
              canUse={canUseEngineer}
              showPricing={showPricing}
              onRevisionMade={load}
            />
          )}
          {tab === 'inspection' && <SetupInspectionTab setups={setups} onOpen={actions.openSetup} onAskEngineer={(id) => actions.askEngineer(latestOf(id))} canUseEngineer={tabs.includes('engineer')} />}
          {tab === 'history' && <SetupHistory setups={setups} actions={actions} />}
        </div>
        </CarViewDebugProvider>
      )}
    </>
  );
}

type OverviewAction = 'import' | 'capture' | 'compare' | 'analyze' | 'revision';

function SetupOverviewPanel({ list, onAction, onOpen }: { list: SetupsList; onAction: (a: OverviewAction) => void; onOpen: (id: number) => void }) {
  const { t, fmt, plural } = useLanguage();
  const s = t.setups;
  const o = s.overview;
  const { overview, collector } = list;
  const capture = overview.latestCapture;
  const setup = overview.latestCaptureSetup;
  const unknown = <span className="text-muted-foreground">{s.common.notAvailable}</span>;
  const stat = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold text-foreground">{value}</div>
    </div>
  );
  const hasValues = list.setups.some((x) => x.latestRevisionId);
  const quick: [OverviewAction, string, typeof Import, boolean][] = [
    ['import', o.importSetup, Import, true],
    ['capture', o.captureLive, RadioTower, true],
    ['compare', o.compareSetups, GitCompare, list.setups.filter((x) => x.latestRevisionId).length >= 2],
    ['analyze', o.analyzeSetup, BrainCircuit, hasValues],
    ['revision', o.createRevision, PlusSquare, hasValues],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat(o.currentCar, collector.live ? collector.car : (setup?.car ?? unknown))}
        {stat(o.currentTrack, collector.live ? collector.track : (setup?.track ?? unknown))}
        {stat(
          o.loadedSetup,
          setup ? (
            <button className="text-left text-primary hover:underline" onClick={() => onOpen(setup.id)}>
              {capture?.simSetupName ?? setup.name}
            </button>
          ) : (
            unknown
          )
        )}
        {stat(o.modified, capture?.simModified == null ? unknown : capture.simModified ? o.modifiedYes : o.modifiedNo)}
        {stat(o.latestInspection, overview.latestInspection ? <InspectionBadge result={overview.latestInspection.result} /> : <InspectionBadge result="notChecked" />)}
        {stat(o.lastSync, capture?.lastSeenAt ? <LocalTime iso={capture.lastSeenAt} format="relative" /> : unknown)}
        {stat(
          o.savedSetups,
          <>
            {overview.setups}
            {overview.archived > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{plural(overview.archived, o.archivedCount, { count: overview.archived })}</span>}
          </>
        )}
        {stat(o.revisions, overview.revisions)}
      </div>

      {overview.glance.length > 0 && (
        <Panel
          title={o.glance}
          actions={
            setup && (
              <button className="text-sm text-primary hover:underline" onClick={() => onOpen(setup.id)}>
                {capture?.simSetupName ?? setup.name}
              </button>
            )
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {overview.glance.map((p) => (
              <div key={p.path} className="rounded-lg border border-border bg-secondary px-3 py-2" title={p.path}>
                <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                  {/* LF/RR for a corner, F/R for an axle's box (iRacing keeps the front bar in FrontBrakes), as iRacing abbreviates them */}
                  {p.group && /^(Left|Right)(Front|Rear)$/.test(p.group)
                    ? `${p.group.replace(/[a-z]/g, '')} `
                    : p.group && /Front/i.test(p.group)
                      ? 'F '
                      : p.group && /Rear/i.test(p.group)
                        ? 'R '
                        : ''}
                  {keyLabel(p.key)}
                </div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-foreground">
                  {p.raw.replace(/\s*\(.*\)\s*$/, '').replace(p.unit ?? '\u0000', '').trim()}
                  {p.unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{p.unit}</span>}
                </div>
                {p.inCar && <div className="text-[10px] text-info-text">{s.common.inCarNote}</div>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={o.quickActions}>
        <div className="flex flex-wrap gap-2">
          {quick.map(([action, label, Icon, enabled]) => (
            <button
              key={action}
              type="button"
              disabled={!enabled}
              onClick={() => onAction(action)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-semibold text-foreground hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="size-4 text-primary" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={o.collector}>
          <p className={collector.live ? 'font-semibold text-good-text' : 'text-muted-foreground'}>{collector.live ? o.collectorLive : o.collectorIdle}</p>
          {collector.live && (
            <p className="mt-1 text-sm text-muted-foreground">
              {collector.car} · {collector.track}
            </p>
          )}
        </Panel>
        <Panel title={o.recentChanges}>
          {overview.recentChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">{list.setups.length ? o.noChanges : s.common.noSetups}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {overview.recentChanges.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <button className="text-left text-primary hover:underline" onClick={() => onOpen(r.setupId)}>
                    {r.setupName} · {fmt(s.common.revisionShort, { number: r.number })}
                  </button>
                  <span className="text-muted-foreground">
                    {s.revisionKinds[r.kind]}
                    {r.changed.length > 0 && ` · ${plural(r.changed.length, o.changesCount, { count: r.changed.length })}`} · <LocalTime iso={r.createdAt} format="relative" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
