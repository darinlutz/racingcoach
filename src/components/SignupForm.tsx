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
    userName: '',
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
        <label htmlFor="userName" className="block text-sm font-medium text-foreground mb-2">
          Name *
        </label>
        <input
          type="text"
          id="userName"
          name="userName"
          value={formData.userName}
          onChange={handleChange}
          required
          autoComplete="name"
          className={inputClass}
        />
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
