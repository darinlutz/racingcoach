// The Learning page's figures, one per chapter of src/lib/learningGuide.ts. Redrawn from the guide's
// illustrative schematics (not telemetry) as SVG in the site's color tokens, so they follow the theme.
// Their text comes from the guide's `figures`, in the user's language.

import type { FigureLabels } from '@/lib/learningGuide';

type Point = [number, number];

type Series = {
  label: string;
  points: Point[];
  color: string;
  dash?: string;
  opacity?: number;
  dots?: boolean;
};

const PRIMARY = 'var(--primary)';
const NEUTRAL = 'var(--foreground)';
const POSITIVE = 'var(--positive)';

const W = 640;
const H = 300;
const M = { left: 56, right: 18, top: 18, bottom: 46 };

// Points from x0 to x1 of f
function sample(f: (x: number) => number, x0 = 0, x1 = 1, n = 120): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / n;
    return [x, f(x)];
  });
}

// A smooth curve through the given points (Catmull-Rom)
function spline(knots: Point[], steps = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const p0 = knots[Math.max(0, i - 1)];
    const [p1, p2] = [knots[i], knots[i + 1]];
    const p3 = knots[Math.min(knots.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, d: number, e: number) =>
        0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (-a + 3 * b - 3 * d + e) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(knots[knots.length - 1]);
  return out;
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 justify-center mt-3 text-sm text-muted-foreground">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-2">
          <svg width="26" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth="3" strokeDasharray={s.dash} strokeLinecap="round" />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

type ChartProps = {
  series: Series[];
  x: [number, number];
  y: [number, number];
  xTicks: number[];
  yTicks?: number[];
  xLabel: string;
  yLabel: string;
  // Dotted vertical lines with a label at the top
  markers?: { x: number; label: string }[];
  title: string;
};

function LineChart({ series, x, y, xTicks, yTicks, xLabel, yLabel, markers = [], title }: ChartProps) {
  const sx = (v: number) => M.left + ((v - x[0]) / (x[1] - x[0])) * (W - M.left - M.right);
  const sy = (v: number) => H - M.bottom - ((v - y[0]) / (y[1] - y[0])) * (H - M.top - M.bottom);
  const path = (pts: Point[]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${sx(a).toFixed(1)},${sy(b).toFixed(1)}`).join('');

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title}>
        {(yTicks ?? []).map((v) => (
          <g key={`y${v}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--chart-grid)" />
            <text x={M.left - 8} y={sy(v)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--muted-foreground)">{v}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - M.bottom + 18} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{v}</text>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--chart-axis)" />
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="var(--chart-axis)" />
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={M.top + 14} y2={H - M.bottom} stroke="var(--chart-dot)" strokeDasharray="2 4" />
            <text x={sx(m.x)} y={M.top + 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted-foreground)">{m.label}</text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <path d={path(s.points)} fill="none" stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth="3" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
            {s.dots && s.points.map(([a, b]) => (
              <circle key={`${a},${b}`} cx={sx(a)} cy={sy(b)} r="5" fill={s.color} stroke="var(--card)" strokeWidth="2" />
            ))}
          </g>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{xLabel}</text>
        <text transform={`translate(15 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{yLabel}</text>
      </svg>
      <Legend series={series} />
    </figure>
  );
}

function Arrow({ x1, y1, x2, y2, label, lx, ly, anchor = 'middle' }: {
  x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number; anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={PRIMARY} strokeWidth="3" markerEnd="url(#learning-arrow)" />
      <text x={lx} y={ly} textAnchor={anchor} fontSize="13" fontWeight="600" fill="var(--foreground)">{label}</text>
    </g>
  );
}

// Top view of a car with where braking, acceleration and cornering move the load
function LoadTransfer({ title, labels: l }: { title: string; labels: FigureLabels }) {
  const tire = (x: number, y: number) => <rect x={x} y={y} width="30" height="58" rx="6" fill="var(--muted-foreground)" fillOpacity="0.6" />;
  return (
    <figure>
      <svg viewBox="0 0 640 320" className="w-full h-auto" role="img" aria-label={title}>
        <defs>
          <marker id="learning-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={PRIMARY} />
          </marker>
        </defs>
        <text x="320" y="22" textAnchor="middle" fontSize="12" fontWeight="600" letterSpacing="2" fill="var(--muted-foreground)">{l.front}</text>
        <text x="320" y="310" textAnchor="middle" fontSize="12" fontWeight="600" letterSpacing="2" fill="var(--muted-foreground)">{l.rear}</text>
        {tire(237, 62)}{tire(373, 62)}{tire(237, 200)}{tire(373, 200)}
        <rect x="260" y="40" width="120" height="240" rx="34" fill="var(--secondary)" stroke="var(--foreground)" strokeOpacity="0.5" strokeWidth="2" />
        <rect x="278" y="110" width="84" height="64" rx="10" fill="var(--card)" stroke="var(--border)" />
        <circle cx="320" cy="160" r="7" fill={PRIMARY} />
        <Arrow x1={320} y1={150} x2={320} y2={50} label={l.brakingLoad} lx={200} ly={56} anchor="end" />
        <Arrow x1={320} y1={170} x2={320} y2={270} label={l.acceleratingLoad} lx={200} ly={272} anchor="end" />
        <Arrow x1={330} y1={160} x2={470} y2={160} label={l.corneringLoad[0]} lx={480} ly={156} anchor="start" />
        <text x="480" y="174" fontSize="13" fontWeight="600" fill="var(--foreground)">{l.corneringLoad[1]}</text>
      </svg>
    </figure>
  );
}

// The traction circle with an illustrative trail-braking path
function TractionCircle({ title, labels: l }: { title: string; labels: FigureLabels }) {
  const c = 170;
  const r = 120;
  const s = (v: number) => v * r;
  const path: Point[] = [[-0.95, 0], [-0.75, -0.4], [-0.42, -0.72], [-0.1, -0.85], [0, -0.95]];
  const series: Series[] = [
    { label: l.tireLimit, points: [], color: NEUTRAL, opacity: 0.55 },
    { label: l.trailPath, points: path, color: PRIMARY },
  ];
  const ticks = [-1, -0.5, 0, 0.5, 1];
  return (
    <figure>
      <svg viewBox="0 0 340 340" className="w-full max-w-[420px] h-auto mx-auto block" role="img" aria-label={title}>
        <g transform={`translate(${c} ${c})`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={s(v)} x2={s(v)} y1={-r - 14} y2={r + 14} stroke="var(--chart-grid)" />
              <line y1={s(v)} y2={s(v)} x1={-r - 14} x2={r + 14} stroke="var(--chart-grid)" />
            </g>
          ))}
          <line x1={-r - 14} x2={r + 14} y1="0" y2="0" stroke="var(--chart-axis)" strokeWidth="1.5" />
          <line y1={-r - 14} y2={r + 14} x1="0" x2="0" stroke="var(--chart-axis)" strokeWidth="1.5" />
          <circle r={r} fill="var(--primary)" fillOpacity="0.06" stroke={NEUTRAL} strokeOpacity="0.55" strokeWidth="2.5" />
          <path d={path.map(([a, b], i) => `${i ? 'L' : 'M'}${s(a)},${-s(b)}`).join('')} fill="none" stroke={PRIMARY} strokeWidth="3" strokeLinejoin="round" />
          {path.map(([a, b]) => <circle key={`${a},${b}`} cx={s(a)} cy={-s(b)} r="5.5" fill={PRIMARY} stroke="var(--card)" strokeWidth="2" />)}
          <text y={-r - 20} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted-foreground)">{l.accelerating}</text>
          <text y={r + 30} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted-foreground)">{l.braking}</text>
          <text x={-r - 20} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted-foreground)" transform={`rotate(-90 ${-r - 20} 0)`}>{l.turning}</text>
          <text x={r + 20} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted-foreground)" transform={`rotate(90 ${r + 20} 0)`}>{l.turning}</text>
        </g>
      </svg>
      <Legend series={series} />
    </figure>
  );
}

// Each chapter's figure, by chapter index
export default function LearningFigure({ index, title, labels: l }: { index: number; title: string; labels: FigureLabels }) {
  switch (index) {
    case 0:
      return <LoadTransfer title={title} labels={l} />;
    case 1:
      return <TractionCircle title={title} labels={l} />;
    case 2: {
      // Later apex: the deepest point moves to 57% of the corner
      const p = Math.log(0.5) / Math.log(0.57);
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[0, 1]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
          xLabel={l.progressThroughCorner} yLabel={l.lateralPosition}
          markers={[{ x: 0.5, label: l.geometricApex }]}
          series={[
            { label: l.geometricArc, points: sample((x) => 0.95 - 0.78 * Math.sin(Math.PI * x)), color: NEUTRAL, opacity: 0.6 },
            { label: l.laterApexPath, points: sample((x) => 0.95 - 0.9 * Math.sin(Math.PI * Math.pow(x, p))), color: PRIMARY },
          ]}
        />
      );
    }
    case 3:
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[0, 105]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[0, 20, 40, 60, 80, 100]}
          xLabel={l.brakingZoneDistance} yLabel={l.brakeCommand}
          series={[
            { label: l.plannedThreshold, points: [[0, 0], [0.1, 100], [0.5, 100], [0.92, 0], [1, 0]], color: PRIMARY },
            { label: l.lateAbrupt, points: [[0, 0], [0.28, 0], [0.4, 100], [0.85, 0], [1, 0]], color: NEUTRAL, opacity: 0.6, dash: '8 6' },
          ]}
        />
      );
    case 4:
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[0, 105]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[0, 20, 40, 60, 80, 100]}
          xLabel={l.cornerEntryProgression} yLabel={l.normalizedInput}
          series={[
            { label: l.brakePressure, points: [[0, 100], [0.58, 0], [1, 0]], color: PRIMARY },
            { label: l.steeringDemand, points: [[0, 0], [0.15, 0], [0.72, 80], [1, 80]], color: NEUTRAL, opacity: 0.6 },
          ]}
        />
      );
    case 5:
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[85, 170]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[90, 110, 130, 150, 170]}
          xLabel={l.progressThroughCorner} yLabel={l.illustrativeSpeed}
          markers={[{ x: 0.2, label: l.entry }, { x: 0.5, label: l.apex }, { x: 0.76, label: l.exit }]}
          series={[
            { label: l.speed, points: spline([[0, 144], [0.2, 133], [0.47, 90.5], [0.76, 145], [1, 166]]), color: PRIMARY },
          ]}
        />
      );
    case 6:
      return (
        <LineChart
          title={title}
          x={[0, 500]} y={[80, 155]} xTicks={[0, 100, 200, 300, 400, 500]} yTicks={[90, 110, 130, 150]}
          xLabel={l.distanceAfterCorner} yLabel={l.speedKmh}
          series={[
            { label: l.driverA, points: sample((d) => 85 + 75 * (1 - Math.exp(-d / 230)), 0, 500), color: NEUTRAL, opacity: 0.6 },
            { label: l.driverB, points: sample((d) => 90 + 73 * (1 - Math.exp(-d / 235)), 0, 500), color: PRIMARY },
          ]}
        />
      );
    case 7: {
      const bell = (x: number) => 0.5 * (1 - Math.cos(2 * Math.PI * x));
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[0, 1.3]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[0, 0.4, 0.8, 1.2]}
          xLabel={l.cornerProgression} yLabel={l.yawRate}
          series={[
            { label: l.referenceYaw, points: sample(bell), color: NEUTRAL, opacity: 0.7 },
            { label: l.underRotation, points: sample((x) => 0.75 * bell(x)), color: PRIMARY, dash: '8 6' },
            { label: l.overRotation, points: sample((x) => 1.22 * bell(x)), color: POSITIVE, dash: '2 6' },
          ]}
        />
      );
    }
    case 8:
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[-1.15, 1.15]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
          xLabel={l.twoCornerProgress} yLabel={l.lateralPosition}
          series={[
            { label: l.balancedPath, points: sample((x) => Math.sin(4 * Math.PI * x), 0, 1, 240), color: PRIMARY },
            { label: l.alternativePath, points: sample((x) => 0.9 * Math.sin(4 * Math.PI * (x - 0.05)), 0, 1, 240), color: NEUTRAL, opacity: 0.6, dash: '8 6' },
          ]}
        />
      );
    default:
      return (
        <LineChart
          title={title}
          x={[0, 1]} y={[85, 185]} xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]} yTicks={[100, 120, 140, 160, 180]}
          xLabel={l.normalizedCornerDistance} yLabel={l.speedKmh}
          series={[
            { label: l.currentLap, points: spline([[0, 159.5], [0.2, 150], [0.35, 118], [0.48, 90], [0.65, 125], [0.82, 162], [1, 170]]), color: NEUTRAL, opacity: 0.6 },
            { label: l.referenceLap, points: spline([[0, 159.5], [0.2, 149], [0.35, 119], [0.46, 98], [0.62, 132], [0.8, 168], [1, 177]]), color: PRIMARY },
          ]}
        />
      );
  }
}
