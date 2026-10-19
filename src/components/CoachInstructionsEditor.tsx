'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Coach page's AI Coach Instructions box: what the AI coach should do, saved for every driver
// (PUT /api/coach/instructions) with the Save AI Coach Instructions button. With inCar, its In-Car AI Coach
// Instructions box instead, for every driver's In-Car AI Coach (PUT /api/coach/in-car-instructions).
export default function CoachInstructionsEditor({
  instructions: initial,
  maxLength,
  inCar = false,
}: {
  instructions: string;
  maxLength: number;
  inCar?: boolean;
}) {
  const { t, fmt } = useLanguage();
  const c = inCar
    ? {
        ...t.coach,
        instructionsTitle: t.coach.inCarTitle,
        instructionsIntro: t.coach.inCarIntro,
        placeholder: t.coach.inCarPlaceholder,
        save: t.coach.inCarSave,
        saved: t.coach.inCarSaved,
      }
    : t.coach;
  const endpoint = inCar ? '/api/coach/in-car-instructions' : '/api/coach/instructions';
  const failed = inCar ? t.api.failedSaveInCarInstructions : t.api.failedSaveInstructions;
  const fieldId = inCar ? 'coach-in-car-instructions' : 'coach-instructions';
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? failed });
        return;
      }
      setSaved(data.instructions);
      setText(data.instructions);
      setMessage({ ok: true, text: c.saved });
    } catch {
      setMessage({ ok: false, text: failed });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-1">{c.instructionsTitle}</h2>
      <p className="text-sm text-muted-foreground mb-4">{c.instructionsIntro}</p>

      <label htmlFor={fieldId} className="sr-only">
        {c.instructionsTitle}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        maxLength={maxLength}
        rows={10}
        placeholder={c.placeholder}
        className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || text.trim() === saved}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? c.saving : c.save}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmt(c.characters, { n: text.length, max: maxLength })}
        </span>
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
