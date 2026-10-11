'use client';

import { useState } from 'react';
import type { CollectorKeyInfo } from '@/lib/collectorKeys';

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' });
}

const buttonClass =
  'shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

// The Account page's upload key for the telemetry collector: create one (shown once, to paste into the
// collector), replace it, or revoke it
export default function CollectorKeyCard({ initialKey }: { initialKey: CollectorKeyInfo | null }) {
  const [info, setInfo] = useState(initialKey);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createKey = async () => {
    if (info && !window.confirm('Replace your upload key? The collector will stop uploading until you enter the new one.')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/collector/key', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create an upload key');
      setInfo(data.info);
      setNewKey(data.key);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create an upload key');
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async () => {
    if (!window.confirm('Revoke your upload key? The collector will stop uploading laps.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/collector/key', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to revoke the upload key');
      setInfo(null);
      setNewKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke the upload key');
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setError('Could not copy; select the key and copy it instead.');
    }
  };

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Telemetry Collector</h2>
      {error && <p className="mb-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">{error}</p>}

      {newKey && (
        <div className="mb-4 space-y-2">
          <p className="text-sm text-foreground">
            Your upload key. Paste it into the RacingCoach collector. It won&apos;t be shown again.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={newKey}
              onFocus={(event) => event.target.select()}
              aria-label="Upload key"
              className="min-w-0 flex-1 px-3 py-2 text-sm font-mono bg-secondary border border-border rounded-lg text-foreground"
            />
            <button type="button" onClick={copyKey} className={buttonClass}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {info ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground font-medium font-mono truncate">{info.keyPrefix}…</p>
            <p className="text-sm text-muted-foreground">
              Created {formatDate(info.createdAt)} · last used {formatDate(info.lastUsedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button type="button" onClick={createKey} disabled={busy} className={buttonClass}>
              Replace Key
            </button>
            <button type="button" onClick={revokeKey} disabled={busy} className={buttonClass}>
              Revoke
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Create an upload key so the RacingCoach collector can send your laps to your account.
          </p>
          <button
            type="button"
            onClick={createKey}
            disabled={busy}
            className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors disabled:opacity-50"
          >
            Create Upload Key
          </button>
        </div>
      )}
    </div>
  );
}
