'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

const selectClass =
  'min-w-0 flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// The Account page's Coach voice: the OpenAI voice the In-Car AI Coach speaks with, saved as soon as it's picked
// (PUT /api/account/coach-voice). Listen plays a sample callout in the picked voice and the user's Preferred
// Language (GET /api/account/coach-voice/sample).
export default function CoachVoicePicker({ voice: initial, voices }: { voice: string; voices: readonly string[] }) {
  const { t } = useLanguage();
  const c = t.inCarCoach;
  const [voice, setVoice] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const choose = async (next: string) => {
    const previous = voice;
    setVoice(next);
    setMessage(null);
    try {
      const res = await fetch('/api/account/coach-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVoice(previous);
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveCoachVoice });
        return;
      }
      setMessage({ ok: true, text: c.voiceSaved });
    } catch {
      setVoice(previous);
      setMessage({ ok: false, text: t.api.failedSaveCoachVoice });
    }
  };

  const listen = () => {
    audio.current?.pause();
    const sample = new Audio(`/api/account/coach-voice/sample?voice=${encodeURIComponent(voice)}`);
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
    <div className="mt-5 pt-4 border-t border-border">
      <label htmlFor="coach-voice" className="block text-sm font-medium text-muted-foreground mb-1">
        {c.voiceTitle}
      </label>
      <p className="text-sm text-muted-foreground mb-3">{c.voiceHint}</p>
      <div className="flex items-center gap-2">
        <select id="coach-voice" value={voice} onChange={(e) => choose(e.target.value)} className={selectClass}>
          {voices.map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
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
