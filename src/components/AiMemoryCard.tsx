'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';

// The Account page's AI Memory card: the user's consent to the Memory Service remembering what they tell the AI
// (src/lib/memory/consent.ts), off until they turn it on. Turning it off asks first, as it deletes what was remembered.
// adminPreview: shown to an Admin while customer capture is still off in the Memory Manager.
export default function AiMemoryCard({ optedInAt, adminPreview }: { optedInAt: string | null; adminPreview: boolean }) {
  const { t, locale } = useLanguage();
  const m = t.aiMemory;
  const [since, setSince] = useState(optedInAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function change(enabled: boolean) {
    if (!enabled && !window.confirm(m.confirmOff)) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/account/ai-memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ text: typeof data.error === 'string' ? data.error : m.errors.failed, error: true });
        return;
      }
      setSince(data.optedInAt ?? null);
      if (!enabled) setMessage({ text: fmt(m.turnedOff, { count: data.deleted ?? 0 }), error: false });
    } catch {
      setMessage({ text: m.errors.failed, error: true });
    } finally {
      setSaving(false);
    }
  }

  const date = since ? new Date(since).toLocaleDateString(locale, { dateStyle: 'long' }) : null;
  return (
    <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">{m.title}</h2>
      <p className="text-sm text-muted-foreground mb-2">{m.intro}</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground mb-3 space-y-1">
        {m.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <label className="flex items-center gap-3 text-foreground font-medium">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={since !== null}
          disabled={saving}
          onChange={(e) => void change(e.target.checked)}
          data-track="ai-memory-toggle"
        />
        {m.toggle}
      </label>
      <p className="text-sm text-muted-foreground mt-2" aria-live="polite">
        {saving ? m.saving : date ? fmt(m.onSince, { date }) : m.off}
      </p>
      {message && <p className={`text-sm mt-2 ${message.error ? 'text-red-400' : 'text-foreground'}`}>{message.text}</p>}
      {adminPreview && <p className="text-xs text-amber-400 mt-2">{m.adminPreview}</p>}
      <Link href="/privacy#ai-memory" className="inline-block text-sm text-primary hover:underline mt-3">
        {m.privacyLink}
      </Link>
    </div>
  );
}
