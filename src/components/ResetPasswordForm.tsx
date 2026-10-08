'use client';

import Link from 'next/link';
import { useState } from 'react';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-6">
        <p className="p-3 rounded-lg bg-positive/10 border border-positive/40 text-positive text-sm">
          Your password has been reset.
        </p>
        <Link
          href="/login"
          className="block w-full text-center px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white font-semibold hover:shadow-lg transition-all"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
          Password * <span className="text-muted-foreground font-normal">(at least 8 characters)</span>
        </label>
        <input
          type="password"
          id="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      {error && (
        <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white font-semibold hover:shadow-lg transition-all disabled:opacity-60"
      >
        {loading ? 'Resetting...' : 'Reset Password'}
      </button>
    </form>
  );
}
