'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Account page's My In-Car AI Coach Instructions box: what the user's own In-Car AI Coach should do
// and not do, saved for them only (PUT /api/account/in-car-coach-instructions) with the Save button.
export default function InCarCoachInstructionsCard({
  instructions: initial,
  maxLength,
}: {
  instructions: string;
  maxLength: number;
}) {
  const { t, fmt } = useLanguage();
  const c = t.inCarCoach;
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/in-car-coach-instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveInCarInstructions });
        return;
      }
      setSaved(data.instructions);
      setText(data.instructions);
      setMessage({ ok: true, text: c.saved });
    } catch {
      setMessage({ ok: false, text: t.api.failedSaveInCarInstructions });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">
        <label htmlFor="in-car-coach-instructions">{c.title}</label>
      </h2>
      <p className="text-sm text-muted-foreground mb-3">{c.intro}</p>
      <textarea
        id="in-car-coach-instructions"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        maxLength={maxLength}
        rows={6}
        placeholder={c.placeholder}
        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
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
