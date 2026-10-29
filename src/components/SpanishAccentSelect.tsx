'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Account page's User Preferences accent box, under Preferred Language and only for Spanish: the accent the
// coach voice speaks Spanish with (Latin American or Spain), saved as soon as it's picked (PUT /api/account/coach-voice).
// The page then reloads from the server so the Coach voice's Listen plays the new accent.
export default function SpanishAccentSelect({
  spanishAccent: initial,
  spanishAccents,
  className,
}: {
  spanishAccent: string;
  spanishAccents: readonly string[];
  className: string;
}) {
  const { t, language } = useLanguage();
  const c = t.inCarCoach;
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [accent, setAccent] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (language !== 'es') return null;

  // A failed save puts the old one back
  const choose = async (next: string) => {
    const previous = accent;
    setAccent(next);
    setMessage(null);
    try {
      const res = await fetch('/api/account/coach-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spanishAccent: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAccent(previous);
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveCoachVoice });
        return;
      }
      setMessage({ ok: true, text: c.accentSaved });
      startRefresh(() => router.refresh());
    } catch {
      setAccent(previous);
      setMessage({ ok: false, text: t.api.failedSaveCoachVoice });
    }
  };

  return (
    <div className="mt-5">
      <label htmlFor="coach-accent" className="block text-sm font-medium text-foreground mb-2">
        {c.accentTitle}
      </label>
      <select id="coach-accent" value={accent} onChange={(e) => void choose(e.target.value)} className={className}>
        {spanishAccents.map((a) => (
          <option key={a} value={a}>
            {c.accents[a as keyof typeof c.accents] ?? a}
          </option>
        ))}
      </select>
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
