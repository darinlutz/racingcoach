'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import {
  BROADCAST_MODES,
  COMMENTARY_FREQUENCIES,
  COVERAGE_FOCUSES,
  INTENSITY_LEVELS,
  lineVolume,
  MAX_ENGINE_FADE_MS,
  type BroadcastSettings,
} from '@/lib/broadcastSettings';
import { engineBed, linkSpeech } from '@/lib/engineBed';
import { ELEVENLABS_PROVIDER, engineBedConfig, SPEECH_PROVIDER_HEADER } from '@/lib/engineBedConfig';

const selectClass =
  'w-full px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

const TOGGLES = ['announceNames', 'statistics', 'strategy', 'preRace', 'postRace'] as const;
const VOLUMES = ['masterVolume', 'leadVolume', 'colorVolume'] as const;
// Volume sliders save once they stop moving
const VOLUME_SAVE_MS = 600;
const FADES = ['engineFadeInMs', 'engineFadeOutMs'] as const;
const FADE_STEP_MS = 50;

// The Account page's Race Broadcast preferences, in the Race Announcers card: how much the announcers say (Broadcast
// Mode, Commentary Frequency), whom they follow (Coverage Focus), how excited they may sound (Maximum Commentary
// Intensity), their volumes, and what they talk about. Each change is saved at once (PUT /api/account/race-announcers
// { broadcast }) and followed by the Commentary Director (src/lib/broadcastDirector.ts) on the Live Racing page and
// TV Broadcast Mode. Under them the engine sound under ElevenLabs speech (src/lib/engineBed.ts), with a Preview of the
// Lead Announcer's voice over it, which follows the sliders as it plays.
export default function BroadcastSettingsPanel({
  initial,
  engineAssets,
  previewVoice,
}: {
  initial: BroadcastSettings;
  engineAssets: { id: number; name: string }[];
  previewVoice: string;
}) {
  const { t, language } = useLanguage();
  const b = t.raceAnnouncers.broadcast;
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef(0);
  // A sound since deleted shows, and plays, as the built-in one
  const engineAsset = engineAssets.some((a) => a.id === settings.engineAsset) ? settings.engineAsset : null;
  const engine = useMemo(() => engineBedConfig(settings, engineAsset), [settings, engineAsset]);
  useEffect(() => engineBed.configure(engine), [engine]);
  const [previewing, setPreviewing] = useState(false);
  const [previewNote, setPreviewNote] = useState('');
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      previewAudio.current?.pause();
      engineBed.shutdown();
    },
    []
  );

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

  const preview = async () => {
    // In the press itself: browsers only let Web Audio make sound after one
    engineBed.unlock();
    previewAudio.current?.pause();
    setPreviewing(true);
    setPreviewNote('');
    try {
      const params = new URLSearchParams({ announcer: 'lead', voice: previewVoice, language });
      const response = await fetch(`/api/account/race-announcers/sample?${params}`);
      if (!response.ok) throw new Error(b.engine.previewFailed);
      const elevenLabs = response.headers.get(SPEECH_PROVIDER_HEADER) === ELEVENLABS_PROVIDER;
      if (!elevenLabs) setPreviewNote(b.engine.previewNotElevenLabs);
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.volume = lineVolume(settings, 'lead');
      previewAudio.current = audio;
      const unlink = elevenLabs ? linkSpeech(engineBed, audio) : null;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onpause = () => resolve();
        audio.play().catch(() => resolve());
      });
      unlink?.();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPreviewNote(err instanceof Error ? err.message : b.engine.previewFailed);
    } finally {
      setPreviewing(false);
    }
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

      <div className="mt-5 pt-4 border-t border-border" data-testid="engine-settings">
        <h4 className="text-sm font-medium text-muted-foreground mb-1">{b.engine.title}</h4>
        <p className="text-sm text-muted-foreground mb-3">{b.engine.intro}</p>
        <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={settings.engineEnabled}
            disabled={off}
            onChange={(e) => change({ engineEnabled: e.target.checked })}
            className="accent-primary"
          />
          {b.engine.enabled}
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-foreground">
            <span className="flex justify-between">
              {b.engine.volume}
              <span className="tabular-nums text-muted-foreground">{settings.engineVolume}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.engineVolume}
              disabled={off || !settings.engineEnabled}
              onChange={(e) => change({ engineVolume: Number(e.target.value) }, VOLUME_SAVE_MS)}
              className="mt-2 w-full accent-primary disabled:opacity-50"
            />
          </label>
          <label className="block text-sm text-foreground">
            {b.engine.asset}
            <select
              value={engineAsset ?? ''}
              disabled={off || !settings.engineEnabled}
              onChange={(e) => change({ engineAsset: e.target.value ? Number(e.target.value) : null })}
              className={`mt-1 ${selectClass} disabled:opacity-50`}
            >
              <option value="">{b.engine.builtIn}</option>
              {engineAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          {FADES.map((key) => (
            <label key={key} className="block text-sm text-foreground">
              <span className="flex justify-between">
                {b.engine[key]}
                <span className="tabular-nums text-muted-foreground">{settings[key]} ms</span>
              </span>
              <input
                type="range"
                min={0}
                max={MAX_ENGINE_FADE_MS}
                step={FADE_STEP_MS}
                value={settings[key]}
                disabled={off || !settings.engineEnabled}
                onChange={(e) => change({ [key]: Number(e.target.value) }, VOLUME_SAVE_MS)}
                className="mt-2 w-full accent-primary disabled:opacity-50"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={preview}
            disabled={off || previewing}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            {previewing ? b.engine.previewing : b.engine.preview}
          </button>
          {previewNote && <span role="status" className="text-sm text-muted-foreground">{previewNote}</span>}
        </div>
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
