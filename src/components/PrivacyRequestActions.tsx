'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { privacyInputClass } from '@/components/ReauthForm';
import type { RequestStatus } from '@/lib/privacyRules';

// The actions on one privacy request for an Admin (PATCH /api/admin/privacy/requests/[id]): change its status with
// the message to the requester and the legal justification, add a note or record a message sent, erase the reviewed
// categories once approved, make an export, link a request made without signing in to an account, or, with
// retryJobId, retry one failed job
export default function PrivacyRequestActions({
  requestId,
  nextStatuses = [],
  linked = false,
  reviewedCategories = [],
  exportKind = 'access',
  retryJobId,
}: {
  requestId: string;
  nextStatuses?: RequestStatus[];
  linked?: boolean;
  reviewedCategories?: string[];
  exportKind?: 'access' | 'portability';
  retryJobId?: number;
}) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyAdmin;
  const p = dictionary.privacyRights;
  const router = useRouter();
  const [to, setTo] = useState<RequestStatus | ''>(nextStatuses[0] ?? '');
  const [resolution, setResolution] = useState('');
  const [justification, setJustification] = useState('');
  const [retained, setRetained] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/admin/privacy/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.errors.failed);
      setMessage(t.actions.done);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const status = (msg: string | null) =>
    msg ? <p role="status" className="mt-2 text-sm text-green-400">{msg}</p> : null;
  const failure = error ? <p role="alert" className="mt-2 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p> : null;
  const button = 'px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
  const secondary =
    'px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

  if (retryJobId !== undefined) {
    return (
      <span>
        <button type="button" disabled={busy} onClick={() => void act({ action: 'retryJob', jobId: retryJobId })} className={`mt-1 ${secondary}`}>
          {t.detail.retry}
        </button>
        {failure}
      </span>
    );
  }

  const transition = async (e: FormEvent) => {
    e.preventDefault();
    if (!to) return;
    const ok = await act({
      action: 'transition',
      to,
      resolution,
      legalJustification: justification,
      retained: retained
        .split('\n')
        .map((line) => line.split(':'))
        .filter((parts) => parts.length >= 2)
        .map(([category, ...reason]) => ({ category: category.trim(), reason: reason.join(':').trim() })),
    });
    if (ok) {
      setResolution('');
      setJustification('');
      setRetained('');
    }
  };

  return (
    <div className="mt-8 rounded-lg border border-border bg-card p-4" data-no-track>
      <h2 className="text-lg font-semibold text-foreground">{t.actions.title}</h2>
      {nextStatuses.length > 0 && (
        <form onSubmit={(e) => void transition(e)} className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-foreground">
            {t.actions.moveTo}
            <select value={to} onChange={(e) => setTo(e.target.value as RequestStatus)} className={privacyInputClass}>
              {nextStatuses.map((value) => (
                <option key={value} value={value}>{p.statuses[value]}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-foreground">
            {t.actions.resolution}
            <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={5000} className={privacyInputClass} />
          </label>
          <label className="block text-sm font-medium text-foreground">
            {t.actions.justification}
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} maxLength={5000} className={privacyInputClass} />
          </label>
          <label className="block text-sm font-medium text-foreground">
            {t.actions.retained}
            <textarea value={retained} onChange={(e) => setRetained(e.target.value)} rows={2} maxLength={5000} className={privacyInputClass} />
          </label>
          <button type="submit" disabled={busy || !to} className={button}>{t.actions.apply}</button>
        </form>
      )}

      <div className="mt-5 space-y-2">
        <label className="block text-sm font-medium text-foreground">
          {t.actions.note}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000} className={privacyInputClass} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !note.trim()} className={secondary}
            onClick={() => void act({ action: 'note', note, communication: false }).then((ok) => ok && setNote(''))}>
            {t.actions.addNote}
          </button>
          <button type="button" disabled={busy || !note.trim()} className={secondary}
            onClick={() => void act({ action: 'note', note, communication: true }).then((ok) => ok && setNote(''))}>
            {t.actions.recordCommunication}
          </button>
        </div>
      </div>

      {linked && reviewedCategories.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-medium text-foreground">{t.actions.erase}: {reviewedCategories.map((c) => p.categories[c] ?? c).join(', ')}</p>
          <button type="button" disabled={busy} className={`mt-2 ${secondary}`}
            onClick={() => void act({ action: 'erase', categories: reviewedCategories })}>
            {t.actions.eraseButton}
          </button>
        </div>
      )}

      {linked && (
        <div className="mt-5">
          <button type="button" disabled={busy} className={secondary} onClick={() => void act({ action: 'export', exportKind })}>
            {t.actions.export}
          </button>
        </div>
      )}

      {!linked && (
        <form className="mt-5" onSubmit={(e) => { e.preventDefault(); void act({ action: 'link', email }); }}>
          <label className="block text-sm font-medium text-foreground">
            {t.actions.link}
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={privacyInputClass} />
              <button type="submit" disabled={busy || !email} className={secondary}>{t.actions.linkButton}</button>
            </div>
          </label>
        </form>
      )}
      {status(message)}
      {failure}
    </div>
  );
}
