'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { usePrivacyReauth } from '@/components/PrivacyReauthProvider';
import ReauthForm from '@/components/ReauthForm';
import type { ExportSummary } from '@/lib/personalDataExport';

// Privacy & Data Rights' Download My Data: asks for a full (Article 15) or portable (Article 20) export, made in the
// background (POST /api/account/privacy/requests), and lists the ones ready to download
// (/api/account/privacy/exports/[id]), until they expire
export default function DownloadMyData({ exports, preparing }: { exports: ExportSummary[]; preparing: boolean }) {
  const { t: dictionary, locale, fmt } = useLanguage();
  const t = dictionary.privacyRights.download;
  const { confirmed, setConfirmed } = usePrivacyReauth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);

  const request = async (type: 'access' | 'portability') => {
    if (!confirmed) {
      setNeedsReauth(true);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/account/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.reauthRequired) {
        setConfirmed(false);
        setNeedsReauth(true);
      }
      if (!response.ok) throw new Error(data.error || dictionary.privacyRights.errors.failed);
      setMessage(t.requested);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.privacyRights.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const size = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1024)} KB`;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['access', 'portability'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => void request(kind)}
            disabled={busy}
            data-track={`privacy-export-${kind}`}
            className="text-left rounded-lg border border-border bg-card px-4 py-3 hover:border-primary transition-colors disabled:opacity-50"
          >
            <span className="block font-semibold text-foreground">{kind === 'access' ? t.access : t.portability}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{kind === 'access' ? t.accessHint : t.portabilityHint}</span>
          </button>
        ))}
      </div>
      {needsReauth && !confirmed && <ReauthForm />}
      {(message || preparing) && <p className="mt-3 text-sm text-green-400" role="status">{message || t.requested}</p>}
      {error && <p role="alert" className="mt-3 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>}
      <h3 className="mt-5 text-sm font-medium text-muted-foreground">{t.ready}</h3>
      {exports.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
          {exports.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {t.kinds[file.kind] ?? file.kind} · {size(file.sizeBytes)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {fmt(t.expires, { date: new Date(file.expiresAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}
                </p>
              </div>
              <a
                href={`/api/account/privacy/exports/${file.id}`}
                data-no-track
                className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-primary hover:bg-primary-strong transition-colors"
              >
                {t.downloadButton}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
