'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { VIDEO_CATEGORIES, type VideoCategory } from '@/lib/broadcastVideoCategories';
import type { LibraryVideo, VideoHistoryRow } from '@/lib/broadcastVideos';
import type { DirectorSettings } from '@/lib/videoDirector';
import type { DirectorDashboardSession } from '@/lib/videoDirectorRuntime';

// The Admin page's Broadcast Director section (src/lib/videoDirector.ts): how it schedules recorded clips on TV Broadcast
// Mode, the sessions it's running right now, and the controls: Play Video Now (through the normal introduction and
// cut), Return to Live and Skip Next Video. Previewing a clip privately is in the Broadcast Video Library.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
const POLL_MS = 2000;

type Switch = 'videosEnabled' | 'autoDirector' | 'rotationEnabled' | 'requireIntroduction' | 'commentaryDuringVideo' | 'postVideoCommentary' | 'videoAudio';
type NumberSetting = 'rotationMapSeconds' | 'rotationVideoSeconds' | 'minIntervalSeconds' | 'maxIntervalSeconds' | 'defaultClipSeconds' | 'transitionMs';

export default function BroadcastDirectorManager() {
  const { t, fmt } = useLanguage();
  const b = t.admin.broadcast;
  const [settings, setSettings] = useState<DirectorSettings | null>(null);
  const [sessions, setSessions] = useState<DirectorDashboardSession[]>([]);
  const [history, setHistory] = useState<VideoHistoryRow[]>([]);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [sessionKey, setSessionKey] = useState('');
  const [category, setCategory] = useState<VideoCategory | ''>('');
  const [videoId, setVideoId] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/broadcast/director', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;
      setSessions(data.sessions);
      setHistory(data.history);
      setSettings((current) => current ?? data.settings);
    } catch {
      // the next poll tries again
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the section opens, then keeps up
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    fetch('/api/admin/broadcast/videos', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setVideos(data.videos))
      .catch(() => undefined);
  }, [sessions.length]);

  const save = async (next: DirectorSettings) => {
    setSettings(next);
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/broadcast/director', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? t.api.failedSaveSetting);
      else setSettings(data.settings);
    } catch {
      setMessage(t.api.failedSaveSetting);
    } finally {
      setSaving(false);
    }
  };

  const current = sessions.find((s) => s.key === sessionKey) ?? sessions[0] ?? null;

  const command = async (body: object) => {
    if (!current) return;
    setMessage('');
    try {
      const response = await fetch('/api/admin/broadcast/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: current.key, ...body }),
      });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? b.failedSave);
      else setSessions(data.sessions);
    } catch {
      setMessage(b.failedSave);
    }
  };

  const seconds = (ms: number | null) => (ms == null ? '—' : fmt(b.seconds, { n: Math.ceil(ms / 1000) }));
  const ready = videos.filter((v) => v.status === 'ready' && v.enabled);
  const switches: { key: Switch; label: string }[] = [
    { key: 'videosEnabled', label: b.videosEnabled },
    { key: 'autoDirector', label: b.autoDirector },
    { key: 'rotationEnabled', label: b.rotationEnabled },
    { key: 'requireIntroduction', label: b.requireIntroduction },
    { key: 'commentaryDuringVideo', label: b.commentaryDuringVideo },
    { key: 'postVideoCommentary', label: b.postVideoCommentary },
    { key: 'videoAudio', label: b.videoAudio },
  ];
  const numbers: { key: NumberSetting; label: string; min: number }[] = [
    { key: 'rotationMapSeconds', label: b.rotationMapSeconds, min: 10 },
    { key: 'rotationVideoSeconds', label: b.rotationVideoSeconds, min: 5 },
    { key: 'minIntervalSeconds', label: b.minInterval, min: 10 },
    { key: 'maxIntervalSeconds', label: b.maxInterval, min: 10 },
    { key: 'defaultClipSeconds', label: b.defaultClip, min: 1 },
    { key: 'transitionMs', label: b.transition, min: 0 },
  ];

  return (
    <div id="broadcast-director" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">{b.directorTitle}</h2>
        <p className="text-sm text-muted-foreground mt-1">{b.directorIntro}</p>
      </div>
      {message && <p className="text-sm text-red-500" role="alert">{message}</p>}

      {/* Live dashboard */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">{b.dashboard}</h3>
        {sessions.length === 0 || !current ? (
          <p className="text-sm text-muted-foreground">{b.noSessions}</p>
        ) : (
          <>
            {sessions.length > 1 && (
              <div className="max-w-md">
                <label className={labelClass}>{b.session}</label>
                <select value={current.key} onChange={(e) => setSessionKey(e.target.value)} className={inputClass}>
                  {sessions.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <dl data-testid="director-dashboard" className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[
                [b.session, current.label],
                [b.currentSource, current.source === 'RECORDED_VIDEO' ? b.sourceVideo : b.sourceMap],
                [b.directorState, current.phase],
                [b.currentCategory, current.clip ? b.categories[current.clip.category as VideoCategory] : '—'],
                [b.currentTitle, current.clip?.title ?? '—'],
                [b.announcers, current.commentaryHeld ? b.announcersHeld : current.announcersBusyMs > 0 ? fmt(b.announcersBusy, { time: seconds(current.announcersBusyMs) }) : b.announcersFree],
                [b.nextEligible, current.nextEligibleMs == null ? b.notScheduled : current.raceBlocked ? b.waitingForRace : seconds(current.nextEligibleMs)],
                [b.pendingClip, current.clip && current.source === 'LIVE_TRACK_MAP' ? current.clip.title : '—'],
                [b.raceIntensity, String(current.raceLevel)],
                [b.viewers, String(current.viewers)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-semibold text-foreground truncate" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
              <div>
                <label className={labelClass}>{b.category}</label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value as VideoCategory | '');
                    setVideoId('');
                  }}
                  className={inputClass}
                >
                  <option value="">{b.anyCategory}</option>
                  {VIDEO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {b.categories[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{b.video}</label>
                <select value={videoId} onChange={(e) => setVideoId(e.target.value)} className={inputClass}>
                  <option value="">{b.anyVideo}</option>
                  {ready
                    .filter((v) => !category || v.category === category)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                </select>
              </div>
              <button type="button" className={primaryClass} onClick={() => command({ action: 'play', category: category || null, videoId: videoId ? Number(videoId) : null })}>
                {b.playNow}
              </button>
              <div className="flex gap-2">
                <button type="button" className={buttonClass} onClick={() => command({ action: 'returnToLive' })}>
                  {b.returnToLive}
                </button>
                <button type="button" className={buttonClass} onClick={() => command({ action: 'skip' })}>
                  {b.skipNext}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Settings */}
      {settings && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">{b.settings}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {switches.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={settings[key]} disabled={saving} onChange={(e) => save({ ...settings, [key]: e.target.checked })} className="accent-primary" />
                {label}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {numbers.map(({ key, label, min }) => (
              <div key={key}>
                <label className={labelClass}>{label}</label>
                <input
                  type="number"
                  min={min}
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                  onBlur={() => save(settings)}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
          <div>
            <p className={labelClass}>{b.categorySettings}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {VIDEO_CATEGORIES.map((c) => (
                <div key={c} className="flex items-center gap-3 text-sm text-foreground">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.categoryEnabled[c] !== false}
                      onChange={(e) => save({ ...settings, categoryEnabled: { ...settings.categoryEnabled, [c]: e.target.checked } })}
                      className="accent-primary"
                    />
                    <span className="truncate">{b.categories[c]}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={fmt(b.categoryWeight, { category: b.categories[c] })}
                    value={settings.categoryWeights[c] ?? 1}
                    onChange={(e) => setSettings({ ...settings, categoryWeights: { ...settings.categoryWeights, [c]: Number(e.target.value) } })}
                    onBlur={() => save(settings)}
                    className={`${inputClass} !w-20`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recently played */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">{b.recentlyPlayed}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{b.nothingPlayed}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="text-foreground">
                    {b.categories[h.category as VideoCategory] ?? h.category}: {h.title}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(h.selectedAt).toLocaleTimeString()} · {h.status}
                    {h.failureReason ? ` (${h.failureReason})` : ''} · {h.trigger}
                  </span>
                </div>
                {h.introductionText && <p className="text-xs text-muted-foreground mt-0.5">“{h.introductionText}”</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
