'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { privacyInputClass } from '@/components/ReauthForm';

// Privacy & Data Rights' Correct My Information (Article 16): the name, corrected at once (PUT /api/account/profile),
// a link to My Settings for the rest of the editable fields, and a rectification request for anything else, which an
// Admin handles (POST /api/account/privacy/requests)
export default function CorrectMyInformation({ userName, maxNameLength }: { userName: string; maxNameLength: number }) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights.correct;
  const router = useRouter();
  const ids = { name: useId(), field: useId(), current: useId(), corrected: useId(), details: useId() };
  const [name, setName] = useState(userName);
  const [correction, setCorrection] = useState({ field: '', current: '', corrected: '', details: '' });
  const [busy, setBusy] = useState<'name' | 'request' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const send = async (url: string, method: string, body: unknown) => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || dictionary.privacyRights.errors.failed);
    return data;
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('name');
    setError('');
    setMessage('');
    try {
      await send('/api/account/profile', 'PUT', { userName: name });
      setMessage(t.nameSaved);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.privacyRights.errors.failed);
    } finally {
      setBusy(null);
    }
  };

  const requestCorrection = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('request');
    setError('');
    setMessage('');
    try {
      const data = await send('/api/account/privacy/requests', 'POST', {
        type: 'rectification',
        details: correction.details,
        corrections: [{ field: correction.field, current: correction.current, corrected: correction.corrected }],
      });
      setMessage(data.message);
      setCorrection({ field: '', current: '', corrected: '', details: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.privacyRights.errors.failed);
    } finally {
      setBusy(null);
    }
  };

  const labelClass = 'block text-sm font-medium text-foreground mb-1';

  return (
    <div data-no-track>
      <form onSubmit={(e) => void saveName(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={ids.name} className={labelClass}>{t.name}</label>
          <input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={maxNameLength}
            required
            autoComplete="name"
            className={privacyInputClass}
          />
        </div>
        <button
          type="submit"
          disabled={busy !== null || !name.trim() || name.trim() === userName}
          className="shrink-0 px-4 py-3 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
        >
          {t.saveName}
        </button>
      </form>
      <Link href="/account" className="mt-3 inline-block text-sm text-primary hover:underline">{t.openSettings}</Link>

      <form onSubmit={(e) => void requestCorrection(e)} className="mt-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t.requestTitle}</h3>
        <div>
          <label htmlFor={ids.field} className={labelClass}>{t.field}</label>
          <input id={ids.field} value={correction.field} maxLength={500} required
            onChange={(e) => setCorrection({ ...correction, field: e.target.value })} className={privacyInputClass} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.current} className={labelClass}>{t.current}</label>
            <input id={ids.current} value={correction.current} maxLength={500}
              onChange={(e) => setCorrection({ ...correction, current: e.target.value })} className={privacyInputClass} />
          </div>
          <div>
            <label htmlFor={ids.corrected} className={labelClass}>{t.corrected}</label>
            <input id={ids.corrected} value={correction.corrected} maxLength={500} required
              onChange={(e) => setCorrection({ ...correction, corrected: e.target.value })} className={privacyInputClass} />
          </div>
        </div>
        <div>
          <label htmlFor={ids.details} className={labelClass}>{t.details}</label>
          <textarea id={ids.details} value={correction.details} maxLength={5000} rows={3}
            onChange={(e) => setCorrection({ ...correction, details: e.target.value })} className={privacyInputClass} />
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {t.submit}
        </button>
      </form>
      {message && <p className="mt-3 text-sm text-green-400" role="status">{message}</p>}
      {error && <p role="alert" className="mt-3 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>}
    </div>
  );
}
