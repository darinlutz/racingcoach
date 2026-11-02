'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// /privacy-request/verify's Confirm Request button: POST /api/privacy/verify with the emailed link's token. A button
// rather than confirming on load, so an email scanner opening the link can't confirm a request nobody made.
export default function PrivacyRequestVerify({ token }: { token: string }) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.privacyRights.public;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const confirm = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/privacy/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      setResult({ ok: response.ok, message: data.message || data.error || t.verifyFailed });
    } catch {
      setResult({ ok: false, message: t.verifyFailed });
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <p role="status" className={`p-4 rounded-lg ${result.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'}`}>
        {result.message}
      </p>
    );
  }
  return (
    <button type="button" onClick={() => void confirm()} disabled={busy || !token} data-no-track
      className="w-full px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors disabled:opacity-50">
      {t.verifyButton}
    </button>
  );
}
