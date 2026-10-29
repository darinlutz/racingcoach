'use client';

import { useRef, useState } from 'react';
import BroadcastSettingsPanel from '@/components/BroadcastSettings';
import type { CoachVoiceDetails } from '@/components/CoachVoicePicker';
import { useLanguage } from '@/components/LanguageProvider';
import type { BroadcastSettings } from '@/lib/broadcastSettings';

const selectClass =
  'min-w-0 flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

type Announcer = 'lead' | 'color';
type Message = { ok: boolean; text: string } | null;

function StatusMessage({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`mt-3 p-3 rounded-lg text-sm ${
        message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
      }`}
    >
      {message.text}
    </p>
  );
}

// One announcer's voice: saved as soon as it's picked, with a Listen button that plays a sample line in it
function AnnouncerVoice({
  announcer,
  label,
  voice: initial,
  voices,
  onMessage,
}: {
  announcer: Announcer;
  label: string;
  voice: string;
  voices: CoachVoiceDetails;
  onMessage: (message: Message) => void;
}) {
  const { t, language } = useLanguage();
  const c = t.inCarCoach;
  const r = t.raceAnnouncers;
  const listed = Object.entries(voices);
  const [picked, setVoice] = useState(initial);
  const voice = listed.some(([name]) => name === picked) ? picked : listed[0][0];
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const choose = async (next: string) => {
    const previous = voice;
    setVoice(next);
    onMessage(null);
    try {
      const res = await fetch('/api/account/race-announcers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcer, voice: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.api.failedSaveRaceAnnouncers);
      onMessage({ ok: true, text: r.voiceSaved });
    } catch (err) {
      setVoice(previous);
      onMessage({ ok: false, text: err instanceof Error ? err.message : t.api.failedSaveRaceAnnouncers });
    }
  };

  const listen = () => {
    audio.current?.pause();
    const sample = new Audio(
      `/api/account/race-announcers/sample?announcer=${announcer}&voice=${encodeURIComponent(voice)}&language=${language}`
    );
    audio.current = sample;
    setLoading(true);
    onMessage(null);
    sample.onplaying = () => setLoading(false);
    sample.onerror = () => {
      setLoading(false);
      onMessage({ ok: false, text: t.api.failedCoachVoiceSample });
    };
    sample.play().catch(() => setLoading(false));
  };

  const id = `announcer-voice-${announcer}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-foreground mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <select id={id} value={voice} onChange={(e) => choose(e.target.value)} className={selectClass}>
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
    </div>
  );
}

// The Account page's Race Announcers, under the Coach voice: the Lead Announcer's and Color Announcer's voices (each
// announcer's ElevenLabs voice of the user's language first, and the default) and the Race Announcer Instructions the
// RaceAnnouncer agent follows when it commentates on the Live Racing page (src/lib/raceAnnouncer.ts), saved with the
// Save button (PUT /api/account/race-announcers), and under them the Race Broadcast preferences
// (src/components/BroadcastSettings.tsx).
export default function RaceAnnouncersSection({
  leadVoice,
  colorVoice,
  leadVoices,
  colorVoices,
  instructions: initial,
  maxLength,
  broadcast,
}: {
  leadVoice: string;
  colorVoice: string;
  leadVoices: CoachVoiceDetails;
  colorVoices: CoachVoiceDetails;
  instructions: string;
  maxLength: number;
  broadcast: BroadcastSettings;
}) {
  const { t, fmt } = useLanguage();
  const r = t.raceAnnouncers;
  const [voiceMessage, setVoiceMessage] = useState<Message>(null);
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/race-announcers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveRaceAnnouncers });
        return;
      }
      setSaved(data.instructions);
      setText(data.instructions);
      setMessage({ ok: true, text: r.instructionsSaved });
    } catch {
      setMessage({ ok: false, text: t.api.failedSaveRaceAnnouncers });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 pb-4 border-b border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{r.title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{r.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <AnnouncerVoice announcer="lead" label={r.lead} voice={leadVoice} voices={leadVoices} onMessage={setVoiceMessage} />
        <AnnouncerVoice announcer="color" label={r.color} voice={colorVoice} voices={colorVoices} onMessage={setVoiceMessage} />
      </div>
      <StatusMessage message={voiceMessage} />

      <label htmlFor="race-announcer-instructions" className="block mt-4 text-sm font-medium text-muted-foreground mb-1">
        {r.instructionsTitle}
      </label>
      <p className="text-sm text-muted-foreground mb-3">{r.instructionsIntro}</p>
      <textarea
        id="race-announcer-instructions"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        maxLength={maxLength}
        rows={4}
        placeholder={r.placeholder}
        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || text.trim() === saved}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? t.inCarCoach.saving : t.inCarCoach.save}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmt(t.inCarCoach.characters, { n: text.length, max: maxLength })}
        </span>
      </div>
      <StatusMessage message={message} />

      <BroadcastSettingsPanel initial={broadcast} />
    </div>
  );
}
