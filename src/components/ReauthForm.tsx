'use client';

import { useId, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { usePrivacyReauth } from '@/components/PrivacyReauthProvider';

export const privacyInputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// "Confirm it's you" on Privacy & Data Rights: the account's password, or, for an account made through Google sign-in,
// a 6-digit code emailed to it (POST /api/account/privacy/reauth). Once confirmed, the sections' actions run.
export default function ReauthForm() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights.reauth;
  const { hasPassword, setConfirmed } = usePrivacyReauth();
  const [secret, setSecret] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/account/privacy/reauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || dictionary.privacyRights.errors.failed);
    return data;
  };

  const sendCode = async () => {
    setError('');
    setBusy(true);
    try {
      await post({ sendCode: true });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.privacyRights.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await post(hasPassword ? { password: secret } : { code: secret });
      setSecret('');
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.privacyRights.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void confirm(e)} className="mt-4 rounded-lg border border-primary/40 bg-secondary px-4 py-4" data-no-track>
      <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
      {!hasPassword && !codeSent ? (
        <button
          type="button"
          onClick={() => void sendCode()}
          disabled={busy}
          className="mt-3 px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
        >
          {busy ? t.sending : t.sendCode}
        </button>
      ) : (
        <>
          {codeSent && <p className="mt-2 text-sm text-muted-foreground">{t.codeSent}</p>}
          <label htmlFor={inputId} className="mt-3 block text-sm font-medium text-foreground">
            {hasPassword ? t.password : t.code}
          </label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              type={hasPassword ? 'password' : 'text'}
              inputMode={hasPassword ? undefined : 'numeric'}
              autoComplete={hasPassword ? 'current-password' : 'one-time-code'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              className={privacyInputClass}
            />
            <button
              type="submit"
              disabled={busy || !secret}
              className="shrink-0 px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
            >
              {busy ? t.confirming : t.confirm}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
