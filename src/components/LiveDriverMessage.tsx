'use client';

import { Mic } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { BrowserMicRecorder, MAX_TALK_MS, MicBlockedError } from '@/lib/browserMicRecorder';
import { reportRateLimit } from '@/lib/rateLimitClient';

// Under Live Racing's Driver Inputs: a message for the focused driver, which their collector says in their In-Car AI
// Coach voice (POST /api/live/message, src/lib/liveRacing.ts). Enter sends it too. Or, with voice (while Enable AI
// Features is on), Hold to Talk: the watcher speaks while holding the button (or Space or Enter on it), and the
// recording goes to POST /api/live/voice-message, so the driver hears the watcher's own voice in their car.

const MAX_CHARS = 200;

type TalkState = 'idle' | 'starting' | 'recording' | 'sending';

// The browser can record the microphone; false on the server
const noSubscription = () => () => {};

export default function LiveDriverMessage({
  driverId,
  driver,
  disabled,
  voice,
}: {
  driverId: number;
  driver: string;
  disabled: boolean;
  voice: boolean;
}) {
  const { t, fmt } = useLanguage();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [talk, setTalk] = useState<TalkState>('idle');
  const canTalk = useSyncExternalStore(noSubscription, BrowserMicRecorder.supported, () => false);
  const recorder = useRef<BrowserMicRecorder | null>(null);
  // Let go while the microphone was still opening: stop as soon as it has
  const released = useRef(false);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      recorder.current?.cancel();
      if (maxTimer.current) clearTimeout(maxTimer.current);
    };
  }, []);

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

  const startTalking = async () => {
    if (talk !== 'idle' || disabled) return;
    released.current = false;
    setResult(null);
    setTalk('starting');
    const mic = (recorder.current ??= new BrowserMicRecorder());
    try {
      await mic.start();
    } catch (err) {
      setTalk('idle');
      setResult({ ok: false, message: err instanceof MicBlockedError ? t.liveRacing.micBlocked : t.liveRacing.micUnavailable });
      return;
    }
    // Let go while the browser was asking for the microphone: nothing was said yet
    if (released.current) {
      mic.cancel();
      setTalk('idle');
      return;
    }
    setTalk('recording');
    maxTimer.current = setTimeout(() => void stopTalking(), MAX_TALK_MS);
  };

  const stopTalking = async () => {
    released.current = true;
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
    const mic = recorder.current;
    if (!mic?.recording) return;
    setTalk('sending');
    try {
      const wav = await mic.stop();
      if (!wav) {
        setResult({ ok: false, message: t.liveRacing.talkTooShort });
        return;
      }
      const response = await fetch(`/api/live/voice-message?driverId=${driverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        reportRateLimit(response, data);
        throw new Error(data.error || t.liveRacing.messageFailed);
      }
      setResult({ ok: true, message: fmt(t.liveRacing.voiceSent, { text: data.text ?? '', name: driver }) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : t.liveRacing.messageFailed });
    } finally {
      setTalk('idle');
    }
  };

  const talking = talk === 'starting' || talk === 'recording';

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
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || sending || disabled}
          className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {sending ? t.liveRacing.messageSending : t.liveRacing.messageDriver}
        </button>
        {voice && canTalk && (
          <>
            <span className="text-xs text-muted-foreground">{t.liveRacing.messageOr}</span>
            <button
              type="button"
              data-track="live-hold-to-talk"
              disabled={disabled || talk === 'sending'}
              aria-pressed={talking}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                void startTalking();
              }}
              onPointerUp={() => void stopTalking()}
              onPointerCancel={() => void stopTalking()}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  void startTalking();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  void stopTalking();
                }
              }}
              onBlur={() => void stopTalking()}
              onContextMenu={(e) => e.preventDefault()}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg border select-none touch-none transition-colors disabled:opacity-50 ${
                talking
                  ? 'bg-red-600 border-red-600 text-white animate-pulse'
                  : 'text-foreground bg-card border-border hover:border-primary hover:text-primary'
              }`}
            >
              <Mic className="size-4" aria-hidden />
              {talk === 'recording' ? t.liveRacing.talkRecording : talk === 'sending' ? t.liveRacing.messageSending : t.liveRacing.holdToTalk}
            </button>
          </>
        )}
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
