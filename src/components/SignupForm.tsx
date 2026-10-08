'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ForgotPasswordForm from './ForgotPasswordForm';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default function SignupForm() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    apiKey: '',
    emailAddress: '',
    password: '',
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
        body: JSON.stringify(formData),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create account');
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
      setLoading(false);
    }
  };

  if (forgotPassword) {
    return <ForgotPasswordForm onBack={() => setForgotPassword(false)} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="apiKey" className="block text-sm font-medium text-foreground mb-2">
          iRacePlan API Key *
        </label>
        <input
          type="password"
          id="apiKey"
          name="apiKey"
          value={formData.apiKey}
          onChange={handleChange}
          required
          maxLength={500}
          autoComplete="off"
          className={inputClass}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to{' '}
          <a href="https://iraceplan.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            iRacePlan
          </a>{' '}
          with your Garage 61 account, then create an API key under Settings &gt; API Keys and paste it here.
          Your driver name comes from your iRacing profile, and your races load into My Race Trends.
        </p>
      </div>

      <div>
        <label htmlFor="emailAddress" className="block text-sm font-medium text-foreground mb-2">
          Email Address *
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
          Password * <span className="text-muted-foreground font-normal">(at least 8 characters)</span>
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

      {error && (
        <p className="p-3 rounded-lg bg-primary/10 border border-primary/40 text-red-300 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 rounded-lg bg-gradient-to-r from-primary to-primary-strong text-white font-semibold hover:shadow-lg transition-all disabled:opacity-60"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline font-medium">
          Log in
        </Link>
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Forgot password?{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setForgotPassword(true);
          }}
          className="text-primary hover:underline font-medium"
        >
          Click here
        </a>
      </p>
    </form>
  );
}
