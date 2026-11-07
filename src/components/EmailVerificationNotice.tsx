'use client';

import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';

// Shown above every page to a signed-in user whose email address isn't confirmed yet (src/lib/emailVerification.ts):
// AI coaching, the telemetry collector's upload key and membership plans wait for it. Resend Link emails a new link
// (POST /api/auth/verify-email, a few an hour). With `verified`, the address was just confirmed: it says so once.
export default function EmailVerificationNotice({ email, verified = false }: { email: string; verified?: boolean }) {
  const { t } = useLanguage();
  const v = t.emailVerification;
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  if (verified) {
    return (
      <section role="status" className="border-b border-border bg-card">
        <p className="site-container py-3 flex items-center gap-2 text-sm">
          <MailCheck className="w-4 h-4 text-primary shrink-0" aria-hidden />
          {v.verified}
        </p>
      </section>
    );
  }

  const resend = async () => {
    setState('sending');
    setError('');
    try {
      const response = await fetch('/api/auth/verify-email', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || v.sendFailed);
        setState('idle');
        return;
      }
      setState('sent');
    } catch {
      setError(v.sendFailed);
      setState('idle');
    }
  };

  return (
    <section role="region" aria-label={v.emailHeading} className="border-b border-border bg-card">
      <div className="site-container py-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
        <p className="flex-1 min-w-0 flex items-start gap-2 text-sm">
          <MailCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
          <span>
            {fmt(v.notice, { email })}
            {state === 'sent' && <span className="block mt-1 text-muted-foreground">{v.sent}</span>}
            {error && <span role="alert" className="block mt-1 text-primary">{error}</span>}
          </span>
        </p>
        <Button
          variant="racing"
          size="sm"
          onClick={resend}
          disabled={state !== 'idle'}
          className="self-start md:self-center"
          data-track="resend-verification"
        >
          {state === 'sending' ? v.resending : v.resend}
        </Button>
      </div>
    </section>
  );
}
