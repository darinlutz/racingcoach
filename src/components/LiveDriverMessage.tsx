'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// Under Live Racing's Driver Inputs: a message for the focused driver, which their collector says in their In-Car AI
// Coach voice (POST /api/live/message, src/lib/liveRacing.ts). Enter sends it too.

const MAX_CHARS = 200;

export default function LiveDriverMessage({ driverId, driver, disabled }: { driverId: number; driver: string; disabled: boolean }) {
  const { t, fmt } = useLanguage();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const send = async () => {
    const message = text.trim();
    if (!message || sending || disabled) return;
    setSending(true);
    setResult(null);
    try {
      const response = await fetch('/api/live/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, text: message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.liveRacing.messageFailed);
      setText('');
      setResult({ ok: true, message: fmt(t.liveRacing.messageSent, { name: driver }) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : t.liveRacing.messageFailed });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-4 py-3 space-y-2" data-track="live-message-driver">
      <textarea
        data-no-track
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        maxLength={MAX_CHARS}
        rows={2}
        placeholder={fmt(t.liveRacing.messagePlaceholder, { name: driver })}
        aria-label={t.liveRacing.messageDriver}
        className="w-full resize-none px-3 py-2 text-sm bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending || disabled}
          className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {sending ? t.liveRacing.messageSending : t.liveRacing.messageDriver}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums ml-auto">
          {text.length}/{MAX_CHARS}
        </span>
      </div>
      {result ? (
        <p className={`text-xs ${result.ok ? 'text-green-500' : 'text-red-300'}`}>{result.message}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{fmt(t.liveRacing.messageHint, { name: driver })}</p>
      )}
    </div>
  );
}
