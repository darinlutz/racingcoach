'use client';

import { useCallback, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';
import { COLLECTOR_DOWNLOAD_URL } from '@/lib/collectorDownload';
import type { CollectorKeyInfo } from '@/lib/collectorKeys';

const buttonClass =
  'shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

// The Account page's telemetry collector card: download the collector, and its upload key: create one
// (shown once, to paste into the collector), replace it, or revoke it. Replacing or revoking asks first in a ConfirmDialog
export default function CollectorKeyCard({ initialKey }: { initialKey: CollectorKeyInfo | null }) {
  const { t, fmt, locale } = useLanguage();
  const [info, setInfo] = useState(initialKey);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Which confirmation is open, if any
  const [confirming, setConfirming] = useState<'replace' | 'revoke' | null>(null);
  // Stable, as ConfirmDialog's Escape listener depends on it
  const closeConfirm = useCallback(() => setConfirming(null), []);

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'long' }) : t.collectorCard.never;

  const createKey = async () => {
    setConfirming(null);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/collector/key', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.collectorCard.failedCreate);
      setInfo(data.info);
      setNewKey(data.key);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.collectorCard.failedCreate);
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async () => {
    setConfirming(null);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/collector/key', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.collectorCard.failedRevoke);
      setInfo(null);
      setNewKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.collectorCard.failedRevoke);
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setError(t.collectorCard.couldNotCopy);
    }
  };

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">{t.collectorCard.title}</h2>

      <div className="mb-4 pb-4 border-b border-border flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-foreground font-medium">{t.collectorCard.appName}</p>
          <p className="text-sm text-muted-foreground">{t.collectorCard.appBlurb}</p>
        </div>
        <a
          href={COLLECTOR_DOWNLOAD_URL}
          className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
        >
          {t.collectorCard.download}
        </a>
      </div>

      {error && <p className="mb-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">{error}</p>}

      {newKey && (
        <div className="mb-4 space-y-2">
          <p className="text-sm text-foreground">{t.collectorCard.yourKey}</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={newKey}
              onFocus={(event) => event.target.select()}
              aria-label={t.collectorCard.keyLabel}
              className="min-w-0 flex-1 px-3 py-2 text-sm font-mono bg-secondary border border-border rounded-lg text-foreground"
            />
            <button type="button" onClick={copyKey} className={buttonClass}>
              {copied ? t.collectorCard.copied : t.collectorCard.copy}
            </button>
          </div>
        </div>
      )}

      {info ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground font-medium font-mono truncate">{info.keyPrefix}…</p>
            <p className="text-sm text-muted-foreground">
              {fmt(t.collectorCard.createdUsed, { created: formatDate(info.createdAt), used: formatDate(info.lastUsedAt) })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setConfirming('replace')} disabled={busy} className={buttonClass}>
              {t.collectorCard.replaceKey}
            </button>
            <button type="button" onClick={() => setConfirming('revoke')} disabled={busy} className={buttonClass}>
              {t.collectorCard.revoke}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t.collectorCard.noKey}</p>
          <button
            type="button"
            onClick={createKey}
            disabled={busy}
            className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors disabled:opacity-50"
          >
            {t.collectorCard.createKey}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming === 'replace'}
        title={t.collectorCard.replaceConfirmTitle}
        confirmLabel={t.collectorCard.replaceKey}
        cancelLabel={t.common.cancel}
        onConfirm={() => void createKey()}
        onCancel={closeConfirm}
      >
        {t.collectorCard.replaceConfirm}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === 'revoke'}
        title={t.collectorCard.revokeConfirmTitle}
        confirmLabel={t.collectorCard.revoke}
        cancelLabel={t.common.cancel}
        onConfirm={() => void revokeKey()}
        onCancel={closeConfirm}
      >
        {t.collectorCard.revokeConfirm}
      </ConfirmDialog>
    </div>
  );
}
