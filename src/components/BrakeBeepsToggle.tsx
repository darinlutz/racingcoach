'use client';

import { useEffect, useRef, useState } from 'react';
import { brakeBeepsGain, MAX_BRAKE_BEEPS_VOLUME, MIN_BRAKE_BEEPS_VOLUME } from '@/lib/brakeBeepsVolume';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';

// How long "Saved" shows after a change
const SAVED_MS = 3000;
// How long the volume slider has to rest before its value is saved, so dragging it saves once
const VOLUME_SAVE_DELAY_MS = 400;

// The collector's beeps (BrakeBeeps.cs and TonePlayer.cs): three warnings, then the higher one at the brakepoint,
// about as far apart as 100 ft takes at 110 mph
const TEST_BEEPS = [
  { hz: 1000, ms: 120 },
  { hz: 1000, ms: 120 },
  { hz: 1000, ms: 120 },
  { hz: 2000, ms: 200 },
];
const TEST_BEEP_SPACING_S = 0.6;
const FADE_S = 0.005; // in and out, so the tone doesn't click
const FULL_AMPLITUDE = 0.9;

// Plays the test beeps at a slider volume with the collector's decibel curve; resolves when they end
function playTestBeeps(volume: number): Promise<void> {
  const context = new AudioContext();
  const gain = FULL_AMPLITUDE * brakeBeepsGain(volume);
  const start = context.currentTime + 0.05;
  TEST_BEEPS.forEach(({ hz, ms }, i) => {
    const at = start + i * TEST_BEEP_SPACING_S;
    const end = at + ms / 1000;
    const oscillator = context.createOscillator();
    oscillator.frequency.value = hz;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + FADE_S);
    envelope.gain.setValueAtTime(gain, end - FADE_S);
    envelope.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(end);
  });
  const last = TEST_BEEPS[TEST_BEEPS.length - 1];
  const totalMs = (0.05 + (TEST_BEEPS.length - 1) * TEST_BEEP_SPACING_S) * 1000 + last.ms + 50;
  return new Promise((resolve) =>
    setTimeout(() => {
      void context.close();
      resolve();
    }, totalMs),
  );
}

// The "Play beeps before braking" Yes / No radio buttons in User Preferences on the Account page. Saved to the
// user's account (racingcoach."Users".brake_beeps), which the telemetry collector reads with its upload key and
// takes up at the next track it loads; a failed save puts the old choice back. With Yes, a Volume slider
// (10-100%, "Users".brake_beeps_volume) sets how loud the collector plays the beeps, in decibels
// (brakeBeepsGain), and Test plays them here at that volume.
export default function BrakeBeepsToggle({
  brakeBeeps: initial,
  volume: initialVolume,
}: {
  brakeBeeps: boolean;
  volume: number;
}) {
  const { t } = useLanguage();
  const units = useUnits();
  const [brakeBeeps, setBrakeBeeps] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(initialVolume);
  const [testing, setTesting] = useState(false);
  // The last volume the account has, put back when a save fails
  const savedVolume = useRef(initialVolume);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const change = async (value: boolean) => {
    if (value === brakeBeeps || saving) return;
    const previous = brakeBeeps;
    setBrakeBeeps(value);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brakeBeeps: value }),
      });
      if (!response.ok) throw new Error();
      setSaved(true);
    } catch {
      setBrakeBeeps(previous);
      setError(t.preferences.brakeBeepsFailed);
    } finally {
      setSaving(false);
    }
  };

  const saveVolume = async (value: number) => {
    if (value === savedVolume.current) return;
    setSaved(false);
    setError('');
    try {
      const response = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brakeBeepsVolume: value }),
      });
      if (!response.ok) throw new Error();
      savedVolume.current = value;
      setSaved(true);
    } catch {
      setVolume(savedVolume.current);
      setError(t.preferences.brakeBeepsFailed);
    }
  };

  const changeVolume = (value: number) => {
    setVolume(value);
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => void saveVolume(value), VOLUME_SAVE_DELAY_MS);
  };

  const test = async () => {
    if (testing) return;
    setTesting(true);
    try {
      await playTestBeeps(volume);
    } finally {
      setTesting(false);
    }
  };

  const options = [
    { value: true, label: t.preferences.yes },
    { value: false, label: t.preferences.no },
  ];

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-foreground mb-2">{t.preferences.brakeBeeps}</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {options.map((option) => (
          <label key={option.label} className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground">
            <input
              type="radio"
              name="brakeBeeps"
              value={option.value ? 'yes' : 'no'}
              checked={brakeBeeps === option.value}
              onChange={() => void change(option.value)}
              disabled={saving}
              data-track={`brake-beeps-${option.value ? 'yes' : 'no'}`}
              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
            />
            <span className="font-semibold">{option.label}</span>
          </label>
        ))}
        <span role="status" aria-live="polite" className="shrink-0 text-sm font-medium text-positive">
          {saving ? t.common.saving : saved ? t.common.saved : ''}
        </span>
      </div>
      {brakeBeeps && (
        <div className="mt-3 flex max-w-md items-center gap-3">
          <label htmlFor="brakeBeepsVolume" className="shrink-0 text-sm font-medium text-foreground">
            {t.preferences.brakeBeepsVolume}
          </label>
          <input
            id="brakeBeepsVolume"
            type="range"
            min={MIN_BRAKE_BEEPS_VOLUME}
            max={MAX_BRAKE_BEEPS_VOLUME}
            step={1}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            data-track="brake-beeps-volume"
            className="w-full accent-primary"
          />
          <span className="w-12 shrink-0 text-right text-sm font-semibold text-foreground tabular-nums">{volume}%</span>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing}
            title={t.preferences.brakeBeepsTestTip}
            data-track="brake-beeps-test"
            className="shrink-0 rounded-md border border-border px-3 py-1 text-sm font-semibold text-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t.preferences.brakeBeepsTest}
          </button>
        </div>
      )}
      <p className="mt-2 text-sm text-muted-foreground">{t.preferences.brakeBeepsHint[units]}</p>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </fieldset>
  );
}
