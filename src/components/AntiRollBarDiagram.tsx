'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { arbBladeAngle, findItem, formatSuspension, toneOf, visibleKinds, type Axle, type SuspensionDrawingProps } from '@/lib/suspensionGeometry';

// One axle's anti-roll bar (from the Lovable design): the bar, its drop links to the two uprights and a blade at each
// end turned by its setting, for each setup. A single setting (iRacing's ArbBlades: 5) turns both blades; a pair
// (2-2) each its own. Schematic: the angle is never a stiffness, and a higher setting isn't drawn as stiffer
export default function AntiRollBarDiagram({ axle, ...props }: SuspensionDrawingProps & { axle: Axle }) {
  const { t, fmt } = useLanguage();
  const s = t.setups.suspension;
  const { comparison, mode } = props;
  const item = findItem(comparison, axle, 'arb');
  const size = findItem(comparison, axle, 'arbSize');
  const name = s.axles[axle];
  return (
    <section className="min-w-0 rounded-lg border border-border p-3 align-grid">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">{fmt(s.arb.heading, { axle: name })}</h4>
        <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{s.arb.blades}</span>
      </div>
      <svg viewBox="0 0 500 230" className="align-svg h-auto w-full" role="img" aria-label={fmt(s.arb.aria, { axle: name })}>
        <path d="M45 195 H455 M250 28 V200" className="align-reference" />
        {[85, 415].map((x) => (
          <g key={x}>
            <rect x={x - 19} y="112" width="38" height="81" rx="7" className="align-chassis" />
            <path
              d={`M${x - 13} 116 V188 M${x + 13} 116 V188 M${x} 151 L${x < 250 ? 155 : 345} 130 M${x} 170 L${x < 250 ? 155 : 345} 148`}
              className="align-structure"
            />
          </g>
        ))}
        {!item && (
          <text x="250" y="90" textAnchor="middle">
            {s.arb.none.toUpperCase()}
          </text>
        )}
        {item &&
          visibleKinds(mode).map((kind, j) => {
            const v = item[kind];
            if (!v) return null;
            const settings = v.pair ?? [v.value, v.value];
            return (
              <g key={kind} className={toneOf(item, kind)} transform={`translate(0 ${j * 7})`}>
                <path d="M105 150 V94 L166 78 H334 L395 94 V150" strokeWidth="3" strokeLinejoin="round" />
                <path d="M166 78 V139 M334 78 V139" strokeWidth="1.4" />
                {settings.map((setting, i) => (
                  <g key={i} transform={`translate(${i ? 334 : 166} 78)`}>
                    <circle r="26" strokeWidth=".6" strokeDasharray="2 5" />
                    <g className="align-rotate" style={{ transform: `rotate(${arbBladeAngle(setting)}deg)` }}>
                      <rect x="-28" y="-5" width="56" height="10" rx="2" strokeWidth="2" />
                    </g>
                    <circle r="4" />
                    <text x={i ? 38 : -38} y={j ? -30 : -45} textAnchor={i ? 'start' : 'end'} className="align-value">
                      {kind === 'baseline' ? s.baselineShort : s.comparisonShort} · {setting}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        <text x="250" y="219" textAnchor="middle">
          {s.arb.footer.toUpperCase()}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">{item?.baseline?.pair || item?.comparison?.pair ? s.arb.pair : s.arb.setting}</span>
        <strong className="font-mono tabular-nums text-align-baseline">{formatSuspension(item?.baseline ?? null)}</strong>
        <strong className="font-mono tabular-nums text-align-comparison">{formatSuspension(item?.comparison ?? null)}</strong>
        {size && (
          <span className="text-muted-foreground">
            {s.params.arbSize}: <span className="font-mono text-foreground">{formatSuspension(size.baseline)}</span> /{' '}
            <span className="font-mono text-foreground">{formatSuspension(size.comparison)}</span>
          </span>
        )}
      </div>
    </section>
  );
}
