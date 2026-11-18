'use client';

import BrakeCylinder from '@/components/BrakeCylinder';
import BrakePart from '@/components/BrakePart';
import { useLanguage } from '@/components/LanguageProvider';
import { balanceTilt, boreRadius, distribution, findItem, meanBore, toneOf, visibleKinds, type BrakeDrawingProps } from '@/lib/brakesGeometry';

// The Brakes tab's pedal box from the side (from the Lovable design): the pedal on its pivot, its pushrod to the
// balance bar (tilted by each setup's bias) and the front and rear master cylinders behind it. Schematic: the balance
// bar's leverage isn't known
export default function BrakePedalAssembly(props: BrakeDrawingProps) {
  const { t } = useLanguage();
  const b = t.setups.brakes;
  const { comparison, mode, application, exaggeration } = props;
  const bias = findItem(comparison, 'bias');
  const front = findItem(comparison, 'frontMaster');
  const rear = findItem(comparison, 'rearMaster');
  const mean = meanBore(comparison);
  return (
    <svg viewBox="0 0 720 310" className="align-svg h-auto w-full" role="img" aria-label={b.pedal.aria}>
      <path d="M50 270 H650 M128 42 V275" className="align-reference" />
      <path d="M60 260 H290 V271 H60 Z M272 260 V135 H300 V260" className="align-chassis" />
      <BrakePart id="pedal" props={props}>
        <g transform="translate(128 244)">
          <g className="align-rotate" style={{ transform: `rotate(${-application * 0.2}deg)` }}>
            <path d="M-8 0 L-20 -161 L10 -172 L17 -158 L8 0 Z" className="align-chassis" />
            <rect x="-32" y="-187" width="56" height="32" rx="4" className="align-structure" />
            {[-26, -18, -10, -2, 6, 14].map((x) => (
              <path key={x} d={`M${x} -182 V-163`} className="align-structure" />
            ))}
          </g>
          <circle r="13" className="align-structure" />
        </g>
      </BrakePart>
      {visibleKinds(mode).map((kind, i) => {
        const d = distribution(comparison, kind);
        return (
          <g key={kind} transform={`translate(0 ${i * 8})`}>
            <path d={`M${128 + application * 0.3} 142 L280 142`} strokeWidth="2" className={toneOf(bias, kind)} />
            <BrakePart id="balance" props={props}>
              <g transform="translate(280 142)">
                <g className={`align-rotate ${toneOf(bias, kind)}`} style={{ transform: `rotate(${balanceTilt(d?.front ?? null)}deg)` }}>
                  <path d="M-9 -45 H9 V45 H-9 Z" strokeWidth="2" />
                  <circle r="7" />
                  <path d="M-7 -40 H45 M-7 40 H45" strokeWidth="2" />
                </g>
              </g>
            </BrakePart>
            <g transform="translate(335 99) scale(.75)">
              <BrakeCylinder bore={front?.[kind] ?? null} radius={boreRadius(front?.[kind] ?? null, mean, exaggeration)} tone={toneOf(front, kind)} application={application} />
            </g>
            <g transform="translate(335 189) scale(.75)">
              <BrakeCylinder bore={rear?.[kind] ?? null} radius={boreRadius(rear?.[kind] ?? null, mean, exaggeration)} tone={toneOf(rear, kind)} application={application} />
            </g>
          </g>
        );
      })}
      <text x="426" y="40">
        {b.pedal.frontMaster.toUpperCase()}
      </text>
      <text x="426" y="252">
        {b.pedal.rearMaster.toUpperCase()}
      </text>
      <text x="280" y="298" textAnchor="middle">
        {b.pedal.footer.toUpperCase()}
      </text>
    </svg>
  );
}
