'use client';

import { useRef, useState } from 'react';
import { voiceOptionLabel, type CoachVoiceDetails } from '@/components/CoachVoicePicker';
import { useLanguage } from '@/components/LanguageProvider';

const selectClass =
  'min-w-0 flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

type Speaker = 'setupEngineer' | 'raceStrategist';
type Message = { ok: boolean; text: string } | null;

// One engineer's voice: saved as soon as it's picked, with a Listen button that plays a sample answer in it
function EngineerVoice({
  speaker,
  label,
  voice: initial,
  voices,
  onMessage,
}: {
  speaker: Speaker;
  label: string;
  voice: string;
  voices: CoachVoiceDetails;
  onMessage: (message: Message) => void;
}) {
  const { t, language } = useLanguage();
  const c = t.inCarCoach;
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
      const res = await fetch('/api/account/engineer-voices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker, voice: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.api.failedSaveEngineerVoice);
      onMessage({ ok: true, text: t.engineerVoices.voiceSaved });
    } catch (err) {
      setVoice(previous);
      onMessage({ ok: false, text: err instanceof Error ? err.message : t.api.failedSaveEngineerVoice });
    }
  };

  const listen = () => {
    audio.current?.pause();
    const sample = new Audio(
      `/api/account/engineer-voices/sample?speaker=${speaker}&voice=${encodeURIComponent(voice)}&language=${language}`
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

  const id = `engineer-voice-${speaker}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-foreground mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <select id={id} value={voice} onChange={(e) => choose(e.target.value)} className={selectClass}>
          {listed.map(([name, detail]) => (
            <option key={name} value={name}>
              {voiceOptionLabel(name, detail, c)}
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

// The Account page's Setup Engineer and Race Strategist voices, between the Coach voice and the Race Announcers: the
// voices those two answer Driver Radio in, each with its own ElevenLabs voice of the user's language first and the
// default (engineer voices in src/lib/coachVoice.ts), saved as soon as they're picked (PUT /api/account/engineer-voices).
export default function EngineerVoicesSection({
  setupEngineerVoice,
  raceStrategistVoice,
  setupEngineerVoices,
  raceStrategistVoices,
  raceStrategistAvailable,
}: {
  setupEngineerVoice: string;
  raceStrategistVoice: string;
  setupEngineerVoices: CoachVoiceDetails;
  raceStrategistVoices: CoachVoiceDetails;
  // The Race Strategist is for Gold members and Admins (canUseRaceStrategist); anyone else is told so in its place
  raceStrategistAvailable: boolean;
}) {
  const { t } = useLanguage();
  const e = t.engineerVoices;
  const [message, setMessage] = useState<Message>(null);

  return (
    <div className="mb-5 pb-4 border-b border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{e.title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{e.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <EngineerVoice
          speaker="setupEngineer"
          label={e.setupEngineer}
          voice={setupEngineerVoice}
          voices={setupEngineerVoices}
          onMessage={setMessage}
        />
        {raceStrategistAvailable ? (
          <EngineerVoice
            speaker="raceStrategist"
            label={e.raceStrategist}
            voice={raceStrategistVoice}
            voices={raceStrategistVoices}
            onMessage={setMessage}
          />
        ) : (
          <div>
            <p className="text-sm font-medium text-foreground mb-1">{e.raceStrategist}</p>
            <p className="text-sm text-muted-foreground">{e.raceStrategistGold}</p>
          </div>
        )}
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
