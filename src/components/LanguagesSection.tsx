import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// Home page's four languages. Each name and sample line is written in its own language, so they aren't in
// the dictionaries. Flags are flag-icons codes (the page imports its CSS): Spanish has both accents the
// coach speaks, Latin American and Spain's, and Portuguese is Brazil's.
const languages = [
  { code: 'en', name: 'English', flags: ['us'], line: 'Your next tenth is in the data.' },
  { code: 'es', name: 'Español', flags: ['mx', 'es'], line: 'Tu próxima décima está en los datos.' },
  { code: 'pt', name: 'Português', flags: ['br'], line: 'Seu próximo décimo está nos dados.' },
  { code: 'de', name: 'Deutsch', flags: ['de'], line: 'Dein nächstes Zehntel steckt in den Daten.' },
];

export default function LanguagesSection({ t, enableAiFeatures }: { t: Dictionary['home']; enableAiFeatures: boolean }) {
  return (
    <section className="site-container feature-section" id="languages">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t.languagesEyebrow}</div>
          <h2>{t.languagesTitle}</h2>
        </div>
        <p>{enableAiFeatures ? t.languagesCopy : t.languagesCopyNoAi}</p>
      </div>
      <div className="language-grid">
        {languages.map((l) => (
          <div className="language-card" key={l.code} lang={l.code}>
            <div className="language-flags" aria-hidden="true">
              {l.flags.map((flag) => <span key={flag} className={`fi fi-${flag}`} />)}
            </div>
            <strong>{l.name}</strong>
            <p>“{l.line}”</p>
          </div>
        ))}
      </div>
    </section>
  );
}
