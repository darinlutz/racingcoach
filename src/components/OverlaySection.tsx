'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { DISTANCE_UNIT, SPEED_UNIT, distanceFromMeters, speedFromMph } from '@/lib/units';

// Landing page sample of the collector's in-car overlay, in the user's units
export default function OverlaySection() {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.home;
  const values = [
    `${Math.round(distanceFromMeters(105, units)).toLocaleString(locale)} ${DISTANCE_UNIT[units]}`,
    `${speedFromMph(42.3, units).toLocaleString(locale, { maximumFractionDigits: 1 })} ${SPEED_UNIT[units]}`,
    '2',
    `−${(0.12).toLocaleString(locale, { minimumFractionDigits: 2 })}`,
  ];

  return (
    <section className="site-container feature-section" id="overlay">
      <div className="overlay-layout">
        <div>
          <div className="eyebrow">{t.overlayEyebrow}</div>
          <h2 className="feature-title">{t.overlayTitle}</h2>
          <p className="muted-copy">{t.overlayCopy}</p>
        </div>
        <div className="overlay-mock" role="group" aria-label={t.overlayLabel}>
          {t.overlayStats.map((label, i) => (
            <div key={label}>
              <span className="stat-label">{label}</span>
              <strong className={`stat-value ${i === values.length - 1 ? 'stat-positive' : ''}`}>{values[i]}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
