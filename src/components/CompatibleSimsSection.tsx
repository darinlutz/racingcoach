import { CircleCheck, Gauge } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// Home page's Compatible sims: the simulators the collector supports (simulators/capabilities.json's
// supported ones), with what each one gets
export default function CompatibleSimsSection({ t }: { t: Dictionary['home'] }) {
  return (
    <section className="sims" id="compatible-sims">
      <div className="site-container sims-layout">
        <div>
          <div className="eyebrow">{t.simsEyebrow}</div>
          <h2 className="feature-title">{t.simsTitle}</h2>
          <p className="muted-copy">{t.simsCopy}</p>
        </div>
        <div className="sims-grid">
          {t.sims.map((sim) => (
            <div className="sim-card" key={sim.name}>
              <div className="sim-card-head">
                <Gauge />
                <span className="sim-badge"><CircleCheck />{t.simsSupported}</span>
              </div>
              <h3>{sim.name}</h3>
              <p>{sim.features}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
