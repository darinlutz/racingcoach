'use client';

import { useId, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { privacyInputClass } from '@/components/ReauthForm';
import { SUBMITTABLE_TYPES } from '@/lib/privacyRules';

// The privacy request form for someone without an account (/privacy-request): POST /api/privacy/requests, then the
// emailed link confirms the address
export default function PublicPrivacyRequestForm() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights;
  const ids = { name: useId(), email: useId(), type: useId(), details: useId() };
  const [form, setForm] = useState({ name: '', email: '', type: 'access', details: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.errors.failed);
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  if (message) return <p className="p-4 rounded-lg bg-green-500/15 text-green-400" role="status">{message}</p>;

  const labelClass = 'block text-sm font-medium text-foreground mb-1';
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-no-track>
      <div>
        <label htmlFor={ids.name} className={labelClass}>{t.public.name}</label>
        <input id={ids.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200}
          autoComplete="name" className={privacyInputClass} />
      </div>
      <div>
        <label htmlFor={ids.email} className={labelClass}>{t.public.email}</label>
        <input id={ids.email} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
          maxLength={320} autoComplete="email" aria-describedby={`${ids.email}-hint`} className={privacyInputClass} />
        <p id={`${ids.email}-hint`} className="mt-1 text-xs text-muted-foreground">{t.public.emailHint}</p>
      </div>
      <div>
        <label htmlFor={ids.type} className={labelClass}>{t.submit.type}</label>
        <select id={ids.type} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={privacyInputClass}>
          {SUBMITTABLE_TYPES.map((type) => (
            <option key={type} value={type}>{t.types[type]}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={ids.details} className={labelClass}>{t.submit.details}</label>
        <textarea id={ids.details} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} required
          maxLength={5000} rows={5} className={privacyInputClass} />
      </div>
      <button type="submit" disabled={busy}
        className="w-full px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors disabled:opacity-50">
        {busy ? t.submit.submitting : t.submit.submit}
      </button>
      {error && <p role="alert" className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>}
    </form>
  );
}
