'use client';

import BrakeCaliper from '@/components/BrakeCaliper';
import BrakeCylinder from '@/components/BrakeCylinder';
import BrakePart from '@/components/BrakePart';
import { useLanguage } from '@/components/LanguageProvider';
import { balanceTilt, boreRadius, CORNERS, distribution, findItem, meanBore, toneOf, visibleKinds, type BrakeDrawingProps, type Corner } from '@/lib/brakesGeometry';

const AT: Record<Corner, [number, number]> = { LF: [218, 165], RF: [622, 165], LR: [218, 440], RR: [622, 440] };

// The Brakes tab's plan view of the whole hydraulic system (from the Lovable design): the pedal, the balance bar, the
// two master cylinders, the front (red) and rear (violet) circuits to the four calipers, and the ABS controller. The
// circuit colors are the circuits', never a setup's; each setup's share of the line pressure is drawn as an arrow at
// each wheel. Every part selects itself for the inspector. Schematic
export default function BrakeHydraulicOverview(props: BrakeDrawingProps) {
  const { t } = useLanguage();
  const b = t.setups.brakes;
  const { comparison, mode, application, component, absStage, exaggeration } = props;
  const kinds = visibleKinds(mode);
  const bias = findItem(comparison, 'bias');
  const front = findItem(comparison, 'frontMaster');
  const rear = findItem(comparison, 'rearMaster');
  const mean = meanBore(comparison);
  const dim = (...systems: string[]) => (component === 'all' || systems.includes(component) ? '' : 'susp-dim');
  const active = application > 0 ? 'brake-flow' : '';
  const intervening = absStage >= 5 && absStage <= 6;
  return (
    <svg viewBox="0 0 840 595" className="align-svg h-auto w-full" role="img" aria-label={b.overview.aria}>
      <path
        d="M300 73 Q420 42 540 73 L567 141 L552 227 L540 394 L562 443 L552 512 Q420 541 288 512 L278 443 L300 394 L288 227 L273 141 Z"
        className="align-chassis"
      />
      <path
        d="M307 230 Q420 201 533 230 L508 289 H332 Z M332 295 H508 V388 H332 Z M337 302 L502 379 M502 302 L337 379 M306 407 H534 M298 493 H542 M305 112 H535"
        className="align-structure"
      />
      <path d="M420 38 V554 M170 165 H670 M170 440 H670" className="align-reference" />

      {/* The circuits */}
      <g className={`brake-circuit-front ${active} ${dim('masters', 'bias', 'calipers')}`}>
        <path d="M372 222 V188 H218 V165 M372 188 H622 V165" className="brake-line" />
        <text x="290" y="180" className="brake-circuit-label">
          {b.overview.frontCircuit.toUpperCase()}
        </text>
      </g>
      <g className={`brake-circuit-rear ${active} ${dim('masters', 'bias', 'calipers')}`}>
        <path d="M467 222 V418 H218 V440 M467 418 H622 V440" className="brake-line" />
        <text x="489" y="411" className="brake-circuit-label">
          {b.overview.rearCircuit.toUpperCase()}
        </text>
      </g>

      {/* The calipers, with each setup's share of the line pressure */}
      {CORNERS.map((corner) => {
        const [x, y] = AT[corner];
        const isFront = corner.endsWith('F');
        return (
          <g key={corner} transform={`translate(${x} ${y})`} className={dim('calipers', 'bias', 'abs')}>
            <BrakePart id={corner} props={props}>
              <rect x="-50" y="-66" width="100" height="132" rx="10" className="brake-target" />
              <g transform="scale(.65)">
                <BrakeCaliper application={application} small tone={isFront ? 'brake-circuit-front' : 'brake-circuit-rear'} />
              </g>
            </BrakePart>
            {kinds.map((kind, i) => {
              const d = distribution(comparison, kind);
              const share = d ? (isFront ? d.front : d.rear) / 100 : 0;
              return (
                <g key={kind} className={toneOf(bias, kind)}>
                  <path d={`M${-22 + i * 45} 74 v${-application * 0.45 * share} m-4 6 l4 -6 l4 6`} strokeWidth="2" className="brake-arrow" />
                  <text x={-13 + i * 38} y="-76" textAnchor="middle" className="align-value">
                    {d ? `${(share * 100).toFixed(d.decimals)}%` : '—'}
                  </text>
                </g>
              );
            })}
            <text x="0" y="100" textAnchor="middle" className="align-wheel-label">
              {corner}
            </text>
            {intervening && corner === 'LF' && <circle r="60" className="brake-abs-pulse" />}
          </g>
        );
      })}

      {/* Master cylinders */}
      {(
        [
          ['frontMaster', 332, front, b.overview.frontMc],
          ['rearMaster', 430, rear, b.overview.rearMc],
        ] as const
      ).map(([id, x, item, label]) => (
        <g key={id} className={dim('masters', 'pedal')}>
          <BrakePart id={id} props={props}>
            <g transform={`translate(${x} 224)`}>
              <rect x="-4" y="-16" width="84" height="42" rx="4" className="brake-target" />
              {kinds.map((kind, i) => (
                <g key={kind} transform={`translate(0 ${i * 6}) scale(.29)`}>
                  <BrakeCylinder bore={item?.[kind] ?? null} radius={boreRadius(item?.[kind] ?? null, mean, exaggeration)} tone={toneOf(item, kind)} application={application} />
                </g>
              ))}
              <text x="34" y="-24" textAnchor="middle">
                {label.toUpperCase()}
              </text>
            </g>
          </BrakePart>
        </g>
      ))}

      {/* Balance bar */}
      <g className={dim('bias', 'pedal')}>
        <BrakePart id="balance" props={props}>
          <g transform="translate(420 267)">
            <rect x="-60" y="-12" width="120" height="24" rx="4" className="brake-target" />
            {kinds.map((kind, i) => (
              <g key={kind} className="align-rotate" style={{ transform: `rotate(${balanceTilt(distribution(comparison, kind)?.front ?? null) * 0.8}deg)` }}>
                <path d={`M-53 ${i * 4} H53`} className={toneOf(bias, kind)} strokeWidth="3" strokeLinecap="round" />
              </g>
            ))}
            <circle r="6" className="align-structure" />
          </g>
        </BrakePart>
      </g>

      {/* Pedal */}
      <g className={dim('pedal')}>
        <BrakePart id="pedal" props={props}>
          <g transform="translate(420 326)">
            <rect x="-28" y="-56" width="56" height="100" rx="4" className="brake-target" />
            <g className="align-rotate" style={{ transform: `rotate(${-application * 0.16}deg)` }}>
              <path d="M-8 -51 H8 V15 H-8 Z M-23 15 H23 V39 H-23 Z" className="align-chassis" />
              <path d="M-15 21 H15 M-15 29 H15" className="align-structure" />
            </g>
          </g>
        </BrakePart>
      </g>

      {/* ABS controller and its lines */}
      <g className={dim('abs')}>
        <path d="M493 324 V298 H622 V215 M493 368 V394 H218 V393" className="align-reference" />
        <BrakePart id="abs" props={props}>
          <g transform="translate(493 346)">
            <rect x="-36" y="-25" width="72" height="50" rx="4" className="brake-target" />
            <rect x="-28" y="-17" width="56" height="34" rx="2" className={`align-chassis ${intervening ? 'brake-abs-box' : ''}`} />
            <text x="0" y="4" textAnchor="middle" className="align-wheel-label">
              ABS
            </text>
            <path d="M-33 -6 H-45 M33 -6 H42 M-20 22 V30 M0 22 V30 M20 22 V30" className="align-structure" />
          </g>
        </BrakePart>
      </g>
      <text x="420" y="575" textAnchor="middle">
        {b.overview.footer.toUpperCase()}
      </text>
    </svg>
  );
}
