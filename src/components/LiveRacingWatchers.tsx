'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { LiveWatcher } from '@/lib/liveRacing';

const buttonClass =
  'shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50';

// The Live Racing page's Who Can Watch Me: the friends the user lets watch them live (added by their account's email
// address, removed with Remove), and the drivers who let the user watch them. GET/POST/DELETE /api/live/watchers
export default function LiveRacingWatchers() {
  const { t, fmt } = useLanguage();
  const [watchers, setWatchers] = useState<LiveWatcher[] | null>(null);
  const [sharedWithMe, setSharedWithMe] = useState<{ id: number; userName: string }[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/live/watchers')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t.api.failedLoadLiveRacing);
        setWatchers(data.watchers);
        setSharedWithMe(data.sharedWithMe);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.api.failedLoadLiveRacing));
  }, [t]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/live/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAddress: email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.api.failedSaveLiveWatchers);
      const watcher = data.watcher as LiveWatcher;
      setWatchers((current) =>
        [...(current ?? []).filter((w) => w.id !== watcher.id), watcher].sort((a, b) => a.userName.localeCompare(b.userName))
      );
      setMessage(fmt(data.already ? t.liveRacing.already : t.liveRacing.added, { name: watcher.userName }));
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.api.failedSaveLiveWatchers);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (watcherId: number) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/live/watchers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watcherId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.api.failedSaveLiveWatchers);
      setWatchers((current) => (current ?? []).filter((w) => w.id !== watcherId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.api.failedSaveLiveWatchers);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="bg-card rounded-lg border border-border px-4 py-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-1">{t.liveRacing.watchersTitle}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t.liveRacing.watchersIntro}</p>
        {error && <p className="mb-3 p-3 rounded-lg text-sm bg-primary/15 border border-primary/40 text-red-300">{error}</p>}
        {message && <p className="mb-3 text-sm text-foreground">{message}</p>}
        <form onSubmit={add} className="flex gap-2 mb-4">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t.liveRacing.emailPlaceholder}
            aria-label={t.liveRacing.emailLabel}
            className="min-w-0 flex-1 px-3 py-2 text-sm bg-secondary border border-border rounded-lg text-foreground"
          />
          <button type="submit" disabled={busy || !email.trim()} className={buttonClass}>
            {busy ? t.liveRacing.adding : t.liveRacing.add}
          </button>
        </form>
        {watchers === null ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : watchers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.liveRacing.watchersEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {watchers.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-foreground font-medium truncate">{w.userName}</p>
                  <p className="text-sm text-muted-foreground truncate">{w.emailAddress}</p>
                </div>
                <button type="button" onClick={() => remove(w.id)} disabled={busy} className={buttonClass}>
                  {t.liveRacing.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="bg-card rounded-lg border border-border px-4 py-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-1">{t.liveRacing.sharedTitle}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t.liveRacing.sharedIntro}</p>
        {sharedWithMe.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.liveRacing.sharedEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {sharedWithMe.map((d) => (
              <li key={d.id} className="py-2 text-foreground font-medium">
                {d.userName}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
