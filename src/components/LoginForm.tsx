'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { withReturnTo } from '@/lib/returnTo';
import ForgotPasswordForm from './ForgotPasswordForm';
import GoogleSignInButton from './GoogleSignInButton';
import { useLanguage } from './LanguageProvider';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// next: where to go once signed in (the page they were trying to reach; / by default). googleEnabled shows
// Sign in with Google (when its credentials are set); googleMessage is what it came back with, if anything.
export default function LoginForm({
  next = '/',
  googleEnabled = false,
  googleMessage,
}: {
  next?: string;
  googleEnabled?: boolean;
  googleMessage?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [formData, setFormData] = useState({ emailAddress: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotPassword, setForgotPassword] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t.auth.failedLogIn);
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.failedLogIn);
      setLoading(false);
    }
  };

  if (forgotPassword) {
    return <ForgotPasswordForm onBack={() => setForgotPassword(false)} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {googleMessage && (
        <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm">{googleMessage}</p>
      )}

      {googleEnabled && (
        <>
          <GoogleSignInButton mode="login" next={next} />
          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <span className="flex-1 border-t border-border" />
            {t.auth.or}
            <span className="flex-1 border-t border-border" />
          </div>
        </>
      )}

      <div>
        <label htmlFor="emailAddress" className="block text-sm font-medium text-foreground mb-2">
          {t.common.emailAddress}
        </label>
        <input
          type="email"
          id="emailAddress"
          name="emailAddress"
          value={formData.emailAddress}
          onChange={handleChange}
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
          {t.common.password}
        </label>
        <input
          type="password"
          id="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required
          autoComplete="current-password"
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
        {loading ? t.auth.loggingIn : t.auth.logIn}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        {t.auth.noAccount}{' '}
        <Link href={withReturnTo('/signup', next)} className="text-primary hover:underline font-medium">
          {t.auth.signUp}
        </Link>
      </p>
      <p className="text-center text-sm text-muted-foreground">
        {t.auth.forgotPassword}{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setForgotPassword(true);
          }}
          className="text-primary hover:underline font-medium"
        >
          {t.auth.clickHere}
        </a>
      </p>
    </form>
  );
}
