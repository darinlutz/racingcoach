'use client';

import { AlertTriangle, BrainCircuit, Check, FlaskConical, Lightbulb, ListChecks, Lock, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import MembershipRequiredDialog from '@/components/MembershipRequiredDialog';
import { Notice, Panel } from '@/components/SetupBadges';
import SetupRevisionPicker, { type RevisionChoice } from '@/components/SetupRevisionPicker';
import ThinkingProgress from '@/components/ThinkingProgress';
import { jsonInit, setupsRequest, type ProposalSummary, type SetupDetailResponse, type SetupSummary } from '@/lib/setupClient';
import { keyLabel } from '@/lib/setupYaml';

// The Setup Engineer on the Setups page: questions about a setup's actual values (and a comparison setup), answered
// with what the data shows, what's likely and what to do, and proposed changes the driver accepts or rejects one by
// one. Accepted changes make a new revision; nothing changes without that
export default function SetupEngineerChat({
  setups,
  value,
  onChange,
  canUse,
  showPricing,
  onRevisionMade,
}: {
  setups: SetupSummary[];
  value: RevisionChoice;
  onChange: (choice: RevisionChoice) => void;
  canUse: boolean;
  showPricing: boolean;
  onRevisionMade: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const s = t.setups;
  const e = s.engineer;
  const [compare, setCompare] = useState<RevisionChoice>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [membership, setMembership] = useState(false);

  // The setup's earlier analyses, newest first
  useEffect(() => {
    if (!value?.setupId) return;
    let live = true;
    void setupsRequest<SetupDetailResponse>(`/api/setups/${value.setupId}`).then((res) => {
      if (live && res.ok) setProposals(res.data.proposals);
    });
    return () => {
      live = false;
    };
  }, [value?.setupId]);

  const ask = async () => {
    if (!value) return;
    if (!question.trim()) return setError(s.errors.questionMissing);
    if (!canUse) return setMembership(true);
    setAsking(true);
    setError('');
    const res = await setupsRequest<{ proposal: ProposalSummary }>(
      '/api/setups/engineer',
      jsonInit('POST', { revisionId: value.revisionId, compareRevisionId: compare?.revisionId ?? null, question })
    );
    setAsking(false);
    if (!res.ok) {
      if (res.code === 'membershipRequired') setMembership(true);
      else if (res.status !== 429) setError(res.error || s.errors.engineerFailed);
      return;
    }
    setProposals((current) => [res.data.proposal, ...current]);
    setQuestion('');
  };

  return (
    <div className="space-y-5">
      <Panel>
        <div className="mb-3 flex items-start gap-3">
          <BrainCircuit className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">{e.intro}</p>
        </div>
        {!canUse && (
          <div className="mb-3">
            <Notice>
              <Lock className="mr-1 inline size-4" aria-hidden />
              {e.membersOnly}
            </Notice>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <SetupRevisionPicker label={e.setup} setups={setups} value={value} onChange={onChange} />
          <SetupRevisionPicker label={e.compareWith} setups={setups} value={compare} onChange={setCompare} noneLabel={e.noCompare} />
        </div>
        <label className="mt-4 block text-sm">
          <span className="font-semibold text-foreground">{e.question}</span>
          <textarea
            value={question}
            onChange={(ev) => setQuestion(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) void ask();
            }}
            maxLength={1000}
            placeholder={e.placeholder}
            className="mt-1 min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={asking || !value}
            onClick={() => void ask()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
          >
            <Send className="size-4" aria-hidden />
            {asking ? e.asking : e.ask}
          </button>
        </div>
        {asking && (
          <div className="mt-4">
            <ThinkingProgress active={asking} expectedMs={15000} />
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </Panel>

      {proposals.map((p, i) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          defaultOpen={i === 0}
          onDecided={async (updated) => {
            setProposals((current) => current.map((x) => (x.id === updated.id ? updated : x)));
            await onRevisionMade();
          }}
        />
      ))}

      <MembershipRequiredDialog open={membership} showPricing={showPricing} onClose={() => setMembership(false)} />
    </div>
  );
}

function ProposalCard({ proposal, defaultOpen, onDecided }: { proposal: ProposalSummary; defaultOpen: boolean; onDecided: (p: ProposalSummary) => Promise<void> }) {
  const { t, fmt } = useLanguage();
  const s = t.setups;
  const e = s.engineer;
  const decided = !!proposal.decidedAt;
  const [choice, setChoice] = useState<Record<string, boolean>>(() => Object.fromEntries(proposal.changes.map((c) => [c.path, c.status === 'accepted'])));
  const [state, setState] = useState<{ busy: boolean; message: string; tone: 'ok' | 'error' | 'info' }>({ busy: false, message: '', tone: 'info' });
  const [open, setOpen] = useState(defaultOpen);
  const a = proposal.answer;

  const apply = async () => {
    setState({ busy: true, message: '', tone: 'info' });
    const accepted = proposal.changes.filter((c) => choice[c.path]).map((c) => c.path);
    const res = await setupsRequest<{ proposal: ProposalSummary; revision: { number: number } | null }>(`/api/setups/proposals/${proposal.id}`, jsonInit('POST', { accepted }));
    if (!res.ok) return setState({ busy: false, message: res.error || s.errors.failed, tone: 'error' });
    setState({
      busy: false,
      tone: 'ok',
      message: res.data.revision ? fmt(e.applied, { number: res.data.revision.number, count: accepted.length }) : e.decidedNone,
    });
    await onDecided(res.data.proposal);
  };

  const section = (title: string, Icon: typeof Lightbulb, items: string[], tone: string) =>
    items.length > 0 && (
      <div>
        <div className={`mb-1 inline-flex items-center gap-1.5 text-sm font-bold ${tone}`}>
          <Icon className="size-4" aria-hidden />
          {title}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <Panel>
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{e.question}</div>
        <div className="font-semibold text-foreground">{proposal.question}</div>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-1 text-sm font-bold text-foreground">{e.summary}</div>
            <p className="text-sm text-foreground">{a.summary}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {section(e.findings, FlaskConical, a.findings, 'text-good-text')}
            {section(e.hypotheses, Lightbulb, a.hypotheses, 'text-info-text')}
            {section(e.recommendations, ListChecks, a.recommendations, 'text-primary')}
          </div>

          <div>
            <div className="mb-1 text-sm font-bold text-foreground">{e.proposals}</div>
            {proposal.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{e.noProposals}</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">{e.proposalsHelp}</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">{s.common.parameter}</th>
                        <th className="px-3 py-2 text-right">{e.current}</th>
                        <th className="px-3 py-2 text-right">{e.proposed}</th>
                        <th className="px-3 py-2">{e.effect}</th>
                        <th className="px-3 py-2">{e.confidence}</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.changes.map((c) => {
                        const parts = c.path.split('.');
                        const on = choice[c.path];
                        return (
                          <tr key={c.path} className={`border-t border-border align-top ${on ? 'bg-primary/5' : ''}`}>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-foreground">{keyLabel(parts[parts.length - 1])}</div>
                              <div className="text-xs text-muted-foreground">{parts.slice(0, -1).map(keyLabel).join(' › ')}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                <span className="font-semibold">{e.why}: </span>
                                {c.reason}
                              </div>
                              {c.warnings.map((w) => (
                                <div key={w} className="mt-1 flex items-start gap-1 text-xs text-tele-warn">
                                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                                  {e.warnings[w]}
                                </div>
                              ))}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{c.current}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-primary">{c.proposed}</td>
                            <td className="px-3 py-2 text-foreground">{c.expectedEffect}</td>
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">{e.confidenceLevels[c.confidence]}</span>
                            </td>
                            <td className="px-3 py-2">
                              {decided ? (
                                <span className={`text-xs font-semibold ${c.status === 'accepted' ? 'text-good-text' : 'text-muted-foreground'}`}>
                                  {c.status === 'accepted' ? e.accept : e.reject}
                                </span>
                              ) : (
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    aria-pressed={on}
                                    title={e.accept}
                                    onClick={() => setChoice({ ...choice, [c.path]: true })}
                                    className={`rounded p-1 ${on ? 'bg-good-text text-background' : 'border border-border'}`}
                                  >
                                    <Check className="size-4" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={!on}
                                    title={e.reject}
                                    onClick={() => setChoice({ ...choice, [c.path]: false })}
                                    className={`rounded p-1 ${!on ? 'bg-secondary text-foreground' : 'border border-border'}`}
                                  >
                                    <X className="size-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!decided && (
                  <button
                    type="button"
                    disabled={state.busy}
                    onClick={() => void apply()}
                    className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-strong disabled:opacity-60"
                  >
                    {state.busy ? e.applying : e.apply}
                  </button>
                )}
              </>
            )}
            {state.message && (
              <div className="mt-3">
                <Notice tone={state.tone}>{state.message}</Notice>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
