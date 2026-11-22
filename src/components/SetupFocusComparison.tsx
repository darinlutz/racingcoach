'use client';

import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { CarViewProvider } from '@/components/CarViewContext';
import { useLanguage } from '@/components/LanguageProvider';
import MembershipRequiredDialog from '@/components/MembershipRequiredDialog';
import { Notice, Panel } from '@/components/SetupBadges';
import { ProposalCard } from '@/components/SetupEngineerChat';
import SetupRevisionPicker, { type RevisionChoice } from '@/components/SetupRevisionPicker';
import { useSetupCarFilter } from '@/components/SetupCarFilter';
import ThinkingProgress from '@/components/ThinkingProgress';
import { jsonInit, setupsRequest, type CompareResponse, type CompareRow, type ProposalSummary } from '@/lib/setupClient';
import type { SetupDashboard } from '@/lib/setupDashboards';

// One system of two setups compared, for the Setups page's engineering system tabs (Alignment, Suspension, Brakes, ...) (docs/setups.md): the same two
// revisions as Compare (the tabs share the pick), read through /api/setups/compare, and drawn by `children` from the
// comparison's rows. Ask Setup Engineer posts the tab's `focus` and `question`; the route builds that system's facts
// from both revisions itself. The drawings show the compared setups' car (CarViewProvider: their iRacing car path, the
// same for both, as revisions of different cars aren't comparable)
export default function SetupFocusComparison({
  setups,
  value,
  onChange,
  engineer,
  focus,
  question,
  systems,
  children,
}: {
  // The engineering systems' row of tabs, shown under the setup box
  systems?: ReactNode;
  setups: Parameters<typeof SetupRevisionPicker>[0]['setups'];
  value: { a: RevisionChoice; b: RevisionChoice };
  onChange: (value: { a: RevisionChoice; b: RevisionChoice }) => void;
  // The Setup Engineer, for Ask Setup Engineer; absent while it's off for the page
  engineer?: { canUse: boolean; showPricing: boolean; onRevisionMade: () => Promise<void> };
  focus: 'alignment' | 'suspension' | 'brakes' | 'tires' | SetupDashboard;
  question: string;
  children: (rows: CompareRow[], ask: { onAsk: () => void; asking: boolean } | undefined) => ReactNode;
}) {
  const { t } = useLanguage();
  const s = t.setups;
  const c = s.compare;
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');

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

  // The Car type and Car filter over the two pickers
  const carFilter = useSetupCarFilter(setups, [value.a?.setupId, value.b?.setupId]);
  const current = data &&data.baseline.id === value.a?.revisionId && data.comparison.id === value.b?.revisionId ? data : null;

  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [answer, setAnswer] = useState<{ key: string; proposal: ProposalSummary } | null>(null);
  const [membership, setMembership] = useState(false);
  const pairKey = `${value.a?.revisionId ?? ''}:${value.b?.revisionId ?? ''}`;
  const ask = async () => {
    if (!engineer || !value.a || !value.b) return;
    if (!engineer.canUse) return setMembership(true);
    setAsking(true);
    setAskError('');
    const res = await setupsRequest<{ proposal: ProposalSummary }>(
      '/api/setups/engineer',
      jsonInit('POST', { revisionId: value.a.revisionId, compareRevisionId: value.b.revisionId, question, focus })
    );
    setAsking(false);
    if (res.ok) return setAnswer({ key: pairKey, proposal: res.data.proposal });
    if (res.code === 'membershipRequired') setMembership(true);
    else if (res.status !== 429) setAskError(res.error || s.errors.engineerFailed);
  };

  return (
    <div className="space-y-5">
      <Panel>
        {carFilter.controls}
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
          <SetupRevisionPicker label={c.baseline} setups={carFilter.filtered} value={value.a} onChange={(a) => onChange({ ...value, a })} />
          <button
            type="button"
            onClick={() => onChange({ a: value.b, b: value.a })}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:border-primary"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            {c.swap}
          </button>
          <SetupRevisionPicker label={c.comparison} setups={carFilter.filtered} value={value.b} onChange={(b) => onChange({ ...value, b })} />
        </div>
      </Panel>
      {systems}

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
        <CarViewProvider carKey={current.baseline.setup.carKey}>
          {children(current.result.rows, engineer ? { onAsk: () => void ask(), asking } : undefined)}
          {asking && <ThinkingProgress active={asking} expectedMs={15000} />}
          {askError && <Notice tone="error">{askError}</Notice>}
          {answer && answer.key === pairKey && engineer && (
            <ProposalCard
              key={answer.proposal.id}
              proposal={answer.proposal}
              defaultOpen
              onDecided={async (updated) => {
                setAnswer({ key: pairKey, proposal: updated });
                await engineer.onRevisionMade();
              }}
            />
          )}
        </CarViewProvider>
      )}
      {engineer && <MembershipRequiredDialog open={membership} showPricing={engineer.showPricing} onClose={() => setMembership(false)} />}
    </div>
  );
}
