'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import {
  BROADCAST_MODES,
  COMMENTARY_FREQUENCIES,
  COVERAGE_FOCUSES,
  INTENSITY_LEVELS,
  type BroadcastSettings,
} from '@/lib/broadcastSettings';

const selectClass =
  'w-full px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

const TOGGLES = ['announceNames', 'statistics', 'strategy', 'preRace', 'postRace'] as const;
const VOLUMES = ['masterVolume', 'leadVolume', 'colorVolume'] as const;
// Volume sliders save once they stop moving
const VOLUME_SAVE_MS = 600;

// The Account page's Race Broadcast preferences, in the Race Announcers card: how much the announcers say (Broadcast
// Mode, Commentary Frequency), whom they follow (Coverage Focus), how excited they may sound (Maximum Commentary
// Intensity), their volumes, and what they talk about. Each change is saved at once (PUT /api/account/race-announcers
// { broadcast }) and followed by the Commentary Director (src/lib/broadcastDirector.ts) on the Live Racing page and
// TV Broadcast Mode.
export default function BroadcastSettingsPanel({ initial }: { initial: BroadcastSettings }) {
  const { t } = useLanguage();
  const b = t.raceAnnouncers.broadcast;
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef(0);

  const save = async (patch: Partial<BroadcastSettings>, previous: BroadcastSettings) => {
    try {
      const res = await fetch('/api/account/race-announcers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcast: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.api.failedSaveRaceAnnouncers);
      setMessage({ ok: true, text: b.saved });
    } catch (err) {
      setSettings(previous);
      setMessage({ ok: false, text: err instanceof Error ? err.message : t.api.failedSaveRaceAnnouncers });
    }
  };

  const change = (patch: Partial<BroadcastSettings>, delayMs = 0) => {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setMessage(null);
    window.clearTimeout(timer.current);
    if (delayMs > 0) timer.current = window.setTimeout(() => save(patch, previous), delayMs);
    else save(patch, previous);
  };

  const off = settings.mode === 'off';
  return (
    <div className="mt-5 pt-4 border-t border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{b.title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{b.intro}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-foreground">
          {b.mode}
          <select value={settings.mode} onChange={(e) => change({ mode: e.target.value as BroadcastSettings['mode'] })} className={`mt-1 ${selectClass}`}>
            {BROADCAST_MODES.map((m) => (
              <option key={m} value={m}>
                {b.modes[m]}
              </option>
            ))}
          </select>
          <span className="block mt-1 text-xs text-muted-foreground">{b.modeHints[settings.mode]}</span>
        </label>
        <label className="block text-sm text-foreground">
          {b.focus}
          <select
            value={settings.focus}
            disabled={off}
            onChange={(e) => change({ focus: e.target.value as BroadcastSettings['focus'] })}
            className={`mt-1 ${selectClass} disabled:opacity-50`}
          >
            {COVERAGE_FOCUSES.map((f) => (
              <option key={f} value={f}>
                {b.focuses[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-foreground">
          {b.frequency}
          <select
            value={settings.frequency}
            disabled={off}
            onChange={(e) => change({ frequency: e.target.value as BroadcastSettings['frequency'] })}
            className={`mt-1 ${selectClass} disabled:opacity-50`}
          >
            {COMMENTARY_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {b.frequencies[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-foreground">
          {b.maxIntensity}
          <select
            value={settings.maxIntensity}
            disabled={off}
            onChange={(e) => change({ maxIntensity: Number(e.target.value) as BroadcastSettings['maxIntensity'] })}
            className={`mt-1 ${selectClass} disabled:opacity-50`}
          >
            {INTENSITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}: {b.intensities[level - 1]}
              </option>
            ))}
          </select>
          <span className="block mt-1 text-xs text-muted-foreground">{b.maxIntensityHint}</span>
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {VOLUMES.map((key) => (
          <label key={key} className="block text-sm text-foreground">
            <span className="flex justify-between">
              {b[key]}
              <span className="tabular-nums text-muted-foreground">{settings[key]}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings[key]}
              disabled={off}
              onChange={(e) => change({ [key]: Number(e.target.value) }, VOLUME_SAVE_MS)}
              className="mt-2 w-full accent-primary disabled:opacity-50"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {TOGGLES.map((key) => (
          <label key={key} className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={settings[key]}
              disabled={off}
              onChange={(e) => change({ [key]: e.target.checked })}
              className="accent-primary"
            />
            {b[key]}
          </label>
        ))}
      </div>

      {message && (
        <p
          role="status"
          className={`mt-3 p-3 rounded-lg text-sm ${message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
