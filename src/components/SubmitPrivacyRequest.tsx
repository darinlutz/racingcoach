'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { privacyInputClass } from '@/components/ReauthForm';

// The request types Submit a Privacy Request offers; access, portability, rectification and erasure have their own
// sections on the page
const TYPES = ['restriction', 'objection', 'other'] as const;

// Privacy & Data Rights' Submit a Privacy Request (Articles 18 and 21, and anything else), which an Admin assesses
// (POST /api/account/privacy/requests)
export default function SubmitPrivacyRequest() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights;
  const router = useRouter();
  const typeId = useId();
  const detailsId = useId();
  const [type, setType] = useState<(typeof TYPES)[number]>('restriction');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/account/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, details }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.errors.failed);
      setMessage(data.message);
      setDetails('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" data-no-track>
      <div>
        <label htmlFor={typeId} className="block text-sm font-medium text-foreground mb-1">{t.submit.type}</label>
        <select id={typeId} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])} className={privacyInputClass}>
          {TYPES.map((value) => (
            <option key={value} value={value}>{t.types[value]}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={detailsId} className="block text-sm font-medium text-foreground mb-1">{t.submit.details}</label>
        <textarea
          id={detailsId}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          required
          maxLength={5000}
          rows={4}
          aria-describedby={`${detailsId}-hint`}
          className={privacyInputClass}
        />
        <p id={`${detailsId}-hint`} className="mt-1 text-xs text-muted-foreground">{t.submit.detailsHint}</p>
      </div>
      <button
        type="submit"
        disabled={busy || !details.trim()}
        className="px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
      >
        {busy ? t.submit.submitting : t.submit.submit}
      </button>
      {message && <p className="text-sm text-green-400" role="status">{message}</p>}
      {error && <p role="alert" className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>}
    </form>
  );
}
