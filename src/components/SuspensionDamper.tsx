// A damper in cutaway, standing up from its top mount: the rod, the piston inside the body, and the bump rubber on the
// rod, `gapPx` above the body's top cap. `shiftPx` compresses it (the rod and the bump rubber move down into the body),
// and the bump rubber turns solid when it touches. `motion` plays the compression or rebound stroke (globals.css's
// susp-stroke). Schematic: the drawing's proportions are not the damper's. The Suspension tab
// (SuspensionEngineeringView.tsx)
export const BODY_TOP = 130;

export default function SuspensionDamper({
  tone,
  gapPx = null,
  shiftPx = 0,
  remaining = null,
  motion = false,
  direction = 'compression',
}: {
  tone: string;
  // The bump rubber's gap in drawing pixels (null: no bump rubber drawn)
  gapPx?: number | null;
  shiftPx?: number;
  // The gap left, as text beside its dimension line
  remaining?: string | null;
  motion?: boolean;
  direction?: 'compression' | 'rebound';
}) {
  const shift = gapPx == null ? shiftPx : Math.min(shiftPx, gapPx);
  const contact = gapPx != null && shiftPx >= gapPx - 1e-6;
  const rubberBottom = gapPx == null ? null : BODY_TOP - gapPx;
  return (
    <g className={tone}>
      {/* Body, its inner wall and the top cap */}
      <rect x="-22" y={BODY_TOP} width="44" height="100" rx="3" strokeWidth="1.7" className="susp-body" />
      <path d={`M-16 ${BODY_TOP + 6} V${BODY_TOP + 94} M16 ${BODY_TOP + 6} V${BODY_TOP + 94}`} strokeWidth=".7" opacity=".6" />
      <path d={`M-26 ${BODY_TOP} H26`} strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M-22 ${BODY_TOP + 34} H22 M-22 ${BODY_TOP + 66} H22`} strokeWidth=".5" opacity=".45" />
      <g transform={`translate(0 ${shift})`}>
        <g className={motion ? `susp-stroke ${direction}` : undefined}>
          <circle cy="8" r="7" strokeWidth="2" />
          <path d="M0 15 V160" strokeWidth="5" strokeLinecap="round" />
          {/* Piston and its valve ports */}
          <rect x="-14" y="156" width="28" height="12" rx="2" strokeWidth="2" />
          <path d="M-7 159 V165 M0 159 V165 M7 159 V165" strokeWidth=".8" opacity=".7" />
          {rubberBottom != null && (
            <path
              d={`M-12 ${rubberBottom - 24} L-16 ${rubberBottom - 20} L-12 ${rubberBottom - 16} L-16 ${rubberBottom - 12} L-12 ${rubberBottom - 8} L-16 ${rubberBottom - 4} L-12 ${rubberBottom} H12 L16 ${rubberBottom - 4} L12 ${rubberBottom - 8} L16 ${rubberBottom - 12} L12 ${rubberBottom - 16} L16 ${rubberBottom - 20} L12 ${rubberBottom - 24} Z`}
              strokeWidth="1.8"
              className={contact ? 'susp-engaged' : undefined}
            />
          )}
        </g>
      </g>
      <path d={`M-9 ${BODY_TOP + 101} V${BODY_TOP + 118} M9 ${BODY_TOP + 101} V${BODY_TOP + 118} M-9 ${BODY_TOP + 118} H9`} strokeWidth="1.5" />
      <circle cy={BODY_TOP + 126} r="6" strokeWidth="1.5" />
      {rubberBottom != null && (
        <>
          <path
            d={`M32 ${rubberBottom + shift} H44 M32 ${BODY_TOP} H44 M38 ${rubberBottom + shift} V${BODY_TOP}`}
            strokeWidth=".8"
            className="susp-dimension"
          />
          {remaining && (
            <text x="48" y={(rubberBottom + shift + BODY_TOP) / 2 + 3} className="align-value">
              {remaining}
            </text>
          )}
        </>
      )}
    </g>
  );
}
