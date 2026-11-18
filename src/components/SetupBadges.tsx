'use client';

import { CheckCircle2, CircleHelp, CircleDashed, XCircle } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import type { SetupSummary } from '@/lib/setupClient';

// Small labels shared by the Setups page's tabs: iRacing's inspection result, where a setup came from and how far its
// file could be read. Unknown is always shown as unknown, never as a pass.

export function InspectionBadge({ result, className = '' }: { result: SetupSummary['inspection']; className?: string }) {
  const { t } = useLanguage();
  const label = t.setups.inspection[result];
  const style =
    result === 'passed'
      ? 'text-good-text border-good-text/40'
      : result === 'failed'
        ? 'text-bad-text border-bad-text/40'
        : 'text-muted-foreground border-border';
  const Icon = result === 'passed' ? CheckCircle2 : result === 'failed' ? XCircle : result === 'unknown' ? CircleHelp : CircleDashed;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${style} ${className}`}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: SetupSummary['source'] }) {
  const { t } = useLanguage();
  return <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{t.setups.sources[source]}</span>;
}

export function ParseBadge({ status }: { status: SetupSummary['parseStatus'] }) {
  const { t } = useLanguage();
  const style = status === 'decoded' ? 'text-good-text' : status === 'partial' || status === 'none' ? 'text-info-text' : 'text-bad-text';
  return (
    <span className={`text-xs font-semibold ${style}`} title={t.setups.parseStatusHelp[status]}>
      {t.setups.parseStatus[status]}
    </span>
  );
}

export function Panel({ title, children, actions, className = '' }: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h3 className="text-base font-bold text-foreground">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: React.ReactNode }) {
  const style = tone === 'error' ? 'text-bad-text border-bad-text/30' : tone === 'ok' ? 'text-good-text border-good-text/30' : 'text-muted-foreground border-border';
  return <p className={`rounded-lg border bg-secondary px-3 py-2 text-sm ${style}`}>{children}</p>;
}
