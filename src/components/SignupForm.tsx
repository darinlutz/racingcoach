'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { withReturnTo } from '@/lib/returnTo';
import { POLICY_VERSIONS } from '@/lib/policyVersions';
import { MAX_PROMO_CODE_LENGTH } from '@/lib/promoCode';
import ForgotPasswordForm from './ForgotPasswordForm';
import GoogleSignInButton from './GoogleSignInButton';
import LanguageSelect from './LanguageSelect';
import { useLanguage } from './LanguageProvider';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// next: where to go once signed in (the page they were trying to reach; / by default). googleEnabled shows
// Sign in with Google (when its credentials are set); googleMessage is what it came back with, if anything.
export default function SignupForm({
  next = '/',
  googleEnabled = false,
  googleMessage,
}: {
  next?: string;
  googleEnabled?: boolean;
  googleMessage?: string;
}) {
  const { t, fmt, language } = useLanguage();
  const router = useRouter();
  const [formData, setFormData] = useState({
    userName: '',
    emailAddress: '',
    password: '',
    promoCode: '',
  });
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
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The Preferred Language box switches the page as soon as it changes, so the page's language is the choice
        // and the policy versions are the ones the agreement line under the button links to
        body: JSON.stringify({ ...formData, preferredLanguage: language, acceptedPolicies: POLICY_VERSIONS }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t.auth.failedCreate);
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.failedCreate);
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
          <GoogleSignInButton mode="signup" next={next} promoCode={formData.promoCode} />
          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <span className="flex-1 border-t border-border" />
            {t.auth.or}
            <span className="flex-1 border-t border-border" />
          </div>
        </>
      )}

      <div>
        <label htmlFor="userName" className="block text-sm font-medium text-foreground mb-2">
          {fmt(t.common.required, { label: t.common.name })}
        </label>
        <input
          type="text"
          id="userName"
          name="userName"
          value={formData.userName}
          onChange={handleChange}
          required
          maxLength={100}
          autoComplete="name"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="emailAddress" className="block text-sm font-medium text-foreground mb-2">
          {fmt(t.common.required, { label: t.common.emailAddress })}
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
          {fmt(t.common.required, { label: t.common.password })}{' '}
          <span className="text-muted-foreground font-normal">{t.common.passwordHint}</span>
        </label>
        <input
          type="password"
          id="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="promoCode" className="block text-sm font-medium text-foreground mb-2">
          {t.common.promoCode} <span className="text-muted-foreground font-normal">{t.common.optional}</span>
        </label>
        <input
          type="text"
          id="promoCode"
          name="promoCode"
          value={formData.promoCode}
          onChange={handleChange}
          maxLength={MAX_PROMO_CODE_LENGTH}
          autoComplete="off"
          className={inputClass}
        />
      </div>

      <LanguageSelect id="preferredLanguage" className={inputClass} />

      {error && (
        <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white font-semibold hover:shadow-lg transition-all disabled:opacity-60"
      >
        {loading ? t.auth.creatingAccount : t.auth.createAccount}
      </button>

      {/* The Terms of Service say creating an account is agreeing to them */}
      <p className="text-center text-xs text-muted-foreground">
        {t.auth.agreeToTerms.split(/(\{terms\}|\{privacy\})/).map((part, i) =>
          part === '{terms}' ? (
            <Link key={i} href="/terms" target="_blank" className="text-primary hover:underline">{t.legal.termsTitle}</Link>
          ) : part === '{privacy}' ? (
            <Link key={i} href="/privacy" target="_blank" className="text-primary hover:underline">{t.legal.privacyTitle}</Link>
          ) : (
            part
          ),
        )}
      </p>

      <p className="text-center text-sm text-muted-foreground">
        {t.auth.haveAccount}{' '}
        <Link href={withReturnTo('/login', next)} className="text-primary hover:underline font-medium">
          {t.auth.logInLink}
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
