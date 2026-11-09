import { Check, Headset, Radio, Wrench } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// Home page's AI race team: the In-Car AI Coach, the Race Engineer and the Setup Engineer, in the order of
// the dictionary's home.team, with a sample question to the Setup Engineer. Only shown while the Admin
// page's Enable AI Features is on.
const teamIcons = [Headset, Radio, Wrench];

export default function AiRaceTeamSection({ t }: { t: Dictionary['home'] }) {
  return (
    <section className="site-container feature-section" id="ai-team">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t.teamEyebrow}</div>
          <h2>{t.teamTitle}</h2>
        </div>
        <p>{t.teamCopy}</p>
      </div>
      <div className="team-grid">
        {t.team.map((member, i) => {
          const Icon = teamIcons[i];
          return (
            <div className="feature-card team-card" key={member.title}>
              <span className="team-icon"><Icon /></span>
              <h3>{member.title}</h3>
              <p className="muted-copy">{member.copy}</p>
              <ul className="check-list">
                {member.points.map((point) => <li key={point}><Check />{point}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="setup-chat" aria-label={t.setupExampleLabel}>
        <div className="insight-tag">{t.setupExampleLabel}</div>
        <div className="chat-line chat-driver">
          <span>{t.setupDriver}</span>
          <p>{t.setupQuestion}</p>
        </div>
        <div className="chat-line chat-engineer">
          <span><Wrench />{t.team[2].title}</span>
          <p>{t.setupAnswer}</p>
        </div>
      </div>
    </section>
  );
}
