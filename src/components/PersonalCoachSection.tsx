'use client';

import { useState } from 'react';
import { Globe, Mic, Sparkles } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';

// Landing page preview of the In-Car AI Coach's language, voice and personal instructions.
// Nothing here is saved; the real ones are on the Account page.

// Each language's sample callout, written in that language
const languages = [
  { code: 'EN', name: 'English', line: 'Brake at the 100 board, carry speed to the apex.' },
  { code: 'ES', name: 'Español', line: 'Frena en el cartel de 100, lleva velocidad al vértice.' },
  { code: 'PT', name: 'Português', line: 'Freie na placa de 100, leve velocidade até o ápice.' },
];

// A few of the Account page's coach voices (COACH_VOICE_DETAILS in src/lib/coachVoice.ts, which is server only)
const voices = [
  { name: 'Charon', style: 'informative' },
  { name: 'Orus', style: 'firm' },
  { name: 'Puck', style: 'upbeat' },
  { name: 'Fenrir', style: 'excitable' },
] as const;

export default function PersonalCoachSection() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.home;
  const styles = dictionary.inCarCoach.voiceStyles;
  const [language, setLanguage] = useState(0);
  const [voice, setVoice] = useState(0);
  const [notes, setNotes] = useState(t.instructionsSample);

  return (
    <section className="site-container feature-section" id="your-coach">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t.coachEyebrow}</div>
          <h2>{t.coachTitle}</h2>
        </div>
        <p>{t.coachCopy}</p>
      </div>
      <div className="coach-grid">
        <div className="feature-card">
          <h3><Globe />{t.languageHeading}</h3>
          <div className="chip-row">
            {languages.map((l, i) => (
              <button key={l.code} type="button" className="chip" aria-pressed={language === i} onClick={() => setLanguage(i)}>
                {l.code} · {l.name}
              </button>
            ))}
          </div>
          <h3><Mic />{t.voiceHeading}</h3>
          <div className="chip-row">
            {voices.map((v, i) => (
              <button key={v.name} type="button" className="chip" aria-pressed={voice === i} onClick={() => setVoice(i)}>
                {v.name}: {styles[v.style]}
              </button>
            ))}
          </div>
          <div className="radio-line">
            <span className="insight-tag">{voices[voice].name} · {languages[language].name}</span>
            <p lang={languages[language].code.toLowerCase()}>“{languages[language].line}”</p>
          </div>
        </div>
        <div className="feature-card">
          <h3><Sparkles />{t.instructionsHeading}</h3>
          <p className="muted-copy">{t.instructionsCopy}</p>
          <textarea className="text-input coach-notes" aria-label={t.instructionsLabel} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="analysis-note">{t.instructionsNote}</p>
        </div>
      </div>
    </section>
  );
}
