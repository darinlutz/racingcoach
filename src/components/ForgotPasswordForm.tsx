'use client';

import { useState } from 'react';
import { useLanguage } from './LanguageProvider';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { t, fmt } = useLanguage();
  const [emailAddress, setEmailAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAddress }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t.auth.failedSendReset);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.failedSendReset);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="resetEmailAddress" className="block text-sm font-medium text-foreground mb-2">
          {fmt(t.common.required, { label: t.common.emailAddress })}
        </label>
        <input
          type="email"
          id="resetEmailAddress"
          name="emailAddress"
          value={emailAddress}
          onChange={(e) => setEmailAddress(e.target.value)}
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      {error && (
        <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm">{error}</p>
      )}
      {sent && (
        <p className="p-3 rounded-lg bg-positive/10 border border-positive/40 text-positive text-sm">
          {fmt(t.auth.resetSent, { email: emailAddress })}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white font-semibold hover:shadow-lg transition-all disabled:opacity-60"
      >
        {loading ? t.auth.sending : t.auth.resetPassword}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        <button type="button" onClick={onBack} className="text-primary hover:underline font-medium">
          {t.auth.backToSignUp}
        </button>
      </p>
    </form>
  );
}
