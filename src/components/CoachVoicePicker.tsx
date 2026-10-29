'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';

const selectClass =
  'min-w-0 flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// Each voice the coach can speak with and its style (coachVoicesFor in src/lib/coachVoice.ts)
export type CoachVoiceDetails = Record<string, { style: string }>;

// The Account page's Coach voice: the Chirp 3 HD voice the In-Car AI Coach speaks with, saved as soon as it's picked
// (PUT /api/account/coach-voice). Listen plays a sample callout in the picked voice, the user's Preferred Language and,
// for Spanish, the accent picked under it in User Preferences (SpanishAccentSelect, which reloads the page with the
// new one) (GET /api/account/coach-voice/sample). The
// ElevenLabs voice is only listed for English; in another language an account with it is shown (and hears) Charon.
const ELEVENLABS_VOICE = 'ElevenLabs';
const DEFAULT_VOICE = 'Charon';
export default function CoachVoicePicker({
  voice: initial,
  voices,
  spanishAccent: accent,
}: {
  voice: string;
  voices: CoachVoiceDetails;
  spanishAccent: string;
}) {
  const { t, language } = useLanguage();
  // Units and language are only in the sample's URL, so a sample cached in other units or another language isn't played
  const units = useUnits();
  const c = t.inCarCoach;
  const listed = Object.entries(voices).filter(([name]) => language === 'en' || name !== ELEVENLABS_VOICE);
  const [picked, setVoice] = useState(initial);
  const voice = listed.some(([name]) => name === picked) ? picked : DEFAULT_VOICE;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Saves the voice; a failed save puts the old one back
  const save = async (body: { voice: string }, saved: string, undo: () => void) => {
    setMessage(null);
    try {
      const res = await fetch('/api/account/coach-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        undo();
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveCoachVoice });
        return;
      }
      setMessage({ ok: true, text: saved });
    } catch {
      undo();
      setMessage({ ok: false, text: t.api.failedSaveCoachVoice });
    }
  };

  const chooseVoice = (next: string) => {
    const previous = voice;
    setVoice(next);
    save({ voice: next }, c.voiceSaved, () => setVoice(previous));
  };

  const listen = () => {
    audio.current?.pause();
    const sample = new Audio(
      `/api/account/coach-voice/sample?voice=${encodeURIComponent(voice)}&accent=${encodeURIComponent(accent)}&units=${units}&language=${language}`
    );
    audio.current = sample;
    setLoading(true);
    setMessage(null);
    sample.onplaying = () => setLoading(false);
    sample.onerror = () => {
      setLoading(false);
      setMessage({ ok: false, text: t.api.failedCoachVoiceSample });
    };
    sample.play().catch(() => setLoading(false));
  };

  return (
    <div className="mb-5 pb-4 border-b border-border">
      <label htmlFor="coach-voice" className="block text-sm font-medium text-muted-foreground mb-1">
        {c.voiceTitle}
      </label>
      <p className="text-sm text-muted-foreground mb-3">{c.voiceHint}</p>
      <div className="flex items-center gap-2">
        <select id="coach-voice" value={voice} onChange={(e) => chooseVoice(e.target.value)} className={selectClass}>
          {listed.map(([name, { style }]) => (
            <option key={name} value={name}>
              {name}: {c.voiceStyles[style as keyof typeof c.voiceStyles] ?? style}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={listen}
          disabled={loading}
          className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {loading ? c.loadingSample : c.listen}
        </button>
      </div>
      {message && (
        <p
          role="status"
          className={`mt-3 p-3 rounded-lg text-sm ${
            message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
