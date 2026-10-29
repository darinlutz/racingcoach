'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { PairedTv } from '@/lib/tvAuth';

const buttonClass =
  'shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

// The TV Link page (TV Broadcast Mode, src/lib/tvAuth.ts): a box for the code the TV shows (POST /api/tv/link), and
// the user's paired TVs, each with Unpair (GET /api/tv/devices, DELETE /api/tv/devices/[id])
export default function TvLink({ days }: { days: number }) {
  const { t, fmt, locale } = useLanguage();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [devices, setDevices] = useState<PairedTv[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/tv/devices', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.tv.failedDevices);
      setDevices(data.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tv.failedDevices);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list, once the page is showing
    load();
  }, [load]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/tv/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.tv.linkFailed);
      setMessage(fmt(t.tv.connected, { label: data.label, days }));
      setCode('');
      // The TV claims its session within a few seconds
      window.setTimeout(load, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tv.linkFailed);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/tv/devices/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.tv.failedDevices);
      setDevices((current) => (current ?? []).filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tv.failedDevices);
    } finally {
      setBusy(false);
    }
  };

  const date = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border px-4 py-4">
        {error && <p className="mb-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">{error}</p>}
        {message && <p className="mb-3 text-sm text-foreground">{message}</p>}
        <form onSubmit={connect} className="flex gap-2">
          <input
            type="text"
            required
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t.tv.codePlaceholder}
            aria-label={t.tv.codeLabel}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            className="min-w-0 flex-1 px-3 py-2 font-mono text-lg tracking-widest bg-secondary border border-border rounded-lg text-foreground"
          />
          <button type="submit" disabled={busy || !code.trim()} className={buttonClass}>
            {busy ? t.tv.connectingTv : t.tv.connect}
          </button>
        </form>
      </div>
      <div className="bg-card rounded-lg border border-border px-4 py-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">{t.tv.devicesTitle}</h2>
        {devices === null ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.tv.devicesEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-foreground font-medium truncate">{d.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmt(t.tv.pairedOn, { date: date(d.createdAt) })}
                    {d.lastSeenAt && ` · ${fmt(t.tv.lastSeen, { date: date(d.lastSeenAt) })}`}
                    {` · ${fmt(t.tv.expiresOn, { date: date(d.expiresAt) })}`}
                  </p>
                </div>
                <button type="button" onClick={() => revoke(d.id)} disabled={busy} className={buttonClass}>
                  {t.tv.revoke}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
