'use client';

import { useId } from 'react';
import type { SkyCondition } from '@/lib/liveWeather';

// Illustrated weather pictures for the TV's Weather Center, the Live Racing page's car status and the weather radar:
// SVG with gradients and gentle SVG animations (no CSS keyframes, so they also run in Fire TV's Silk browser). Each
// instance has its own gradient ids (useId), as several are drawn on one page.

type ArtProps = { className?: string; title?: string };

function Sun({ id, cx, cy, r, spin = true }: { id: string; cx: number; cy: number; r: number; spin?: boolean }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-sun`} cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff6c2" />
          <stop offset="45%" stopColor="#ffd23f" />
          <stop offset="100%" stopColor="#ff9f1c" />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor="#ffd23f" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffd23f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r * 2.1} fill={`url(#${id}-glow)`} />
      <g>
        {spin && <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="40s" repeatCount="indefinite" />}
        {rays.map((deg) => (
          <rect
            key={deg}
            x={cx - r * 0.09}
            y={cy - r * 1.62}
            width={r * 0.18}
            height={r * 0.42}
            rx={r * 0.09}
            fill="#ffc43d"
            transform={`rotate(${deg} ${cx} ${cy})`}
          />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-sun)`} />
    </g>
  );
}

function Moon({ id, cx, cy, r }: { id: string; cx: number; cy: number; r: number }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-moon`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fdfbe8" />
          <stop offset="100%" stopColor="#c9cfe6" />
        </linearGradient>
        <radialGradient id={`${id}-mglow`}>
          <stop offset="0%" stopColor="#c7d2fe" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-crescent`}>
          <rect x="0" y="0" width="100" height="100" fill="white" />
          <circle cx={cx + r * 0.55} cy={cy - r * 0.35} r={r * 0.85} fill="black" />
        </mask>
      </defs>
      <circle cx={cx} cy={cy} r={r * 1.9} fill={`url(#${id}-mglow)`} />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-moon)`} mask={`url(#${id}-crescent)`} />
      {[
        [cx + r * 1.3, cy - r * 0.9, 1.4],
        [cx + r * 1.7, cy + r * 0.3, 1],
      ].map(([x, y, s], i) => (
        <circle key={i} cx={x} cy={y} r={s} fill="#fdfbe8">
          <animate attributeName="opacity" values="1;0.3;1" dur={`${2.5 + i}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

// A cloud around (x, y), w wide; dark for rain clouds
function CloudShape({ id, x, y, w, dark = false, drift = true }: { id: string; x: number; y: number; w: number; dark?: boolean; drift?: boolean }) {
  const s = w / 60;
  const gid = `${id}-cloud-${dark ? 'd' : 'l'}-${Math.round(x)}-${Math.round(y)}`;
  return (
    <g>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          {dark ? (
            <>
              <stop offset="0%" stopColor="#9aa6b8" />
              <stop offset="100%" stopColor="#4b5566" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#cfd8e6" />
            </>
          )}
        </linearGradient>
      </defs>
      <g transform={`translate(${x - 30 * s} ${y - 20 * s}) scale(${s})`}>
        {drift && <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0; 2 0; 0 0" dur="7s" repeatCount="indefinite" />}
        <path
          d="M14 38 C5 38 2 30 7 24 C9 21 13 20 15 20 C16 12 23 7 31 8 C38 9 42 14 44 19 C46 18 49 18 51 19 C57 21 59 27 57 32 C56 36 52 38 48 38 Z"
          fill="#000"
          opacity="0.18"
          transform="translate(1.5 2.5)"
        />
        <path
          d="M14 38 C5 38 2 30 7 24 C9 21 13 20 15 20 C16 12 23 7 31 8 C38 9 42 14 44 19 C46 18 49 18 51 19 C57 21 59 27 57 32 C56 36 52 38 48 38 Z"
          fill={`url(#${gid})`}
        />
        <path d="M17 21 C19 14 25 11 31 11" fill="none" stroke="#fff" strokeOpacity={dark ? 0.25 : 0.9} strokeWidth="2" strokeLinecap="round" />
      </g>
    </g>
  );
}

// Falling drops under a cloud: count of them across [x0, x1] from y
function Drops({ id, x0, x1, y, count, heavy = false }: { id: string; x0: number; x1: number; y: number; count: number; heavy?: boolean }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-drop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe3ff" />
          <stop offset="100%" stopColor="#2f8bff" />
        </linearGradient>
      </defs>
      {Array.from({ length: count }, (_, i) => {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / count;
        const dur = heavy ? 0.7 + (i % 3) * 0.12 : 1.1 + (i % 3) * 0.2;
        const delay = (i * 0.37) % dur;
        const len = heavy ? 9 : 7;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(12)`}>
            <path d={`M0 0 C-2.2 ${len * 0.55} -2.2 ${len} 0 ${len} C2.2 ${len} 2.2 ${len * 0.55} 0 0 Z`} fill={`url(#${id}-drop)`}>
              <animateTransform attributeName="transform" type="translate" values={`0 -4; 0 ${heavy ? 22 : 18}`} dur={`${dur}s`} begin={`-${delay}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.75;1" dur={`${dur}s`} begin={`-${delay}s`} repeatCount="indefinite" />
            </path>
          </g>
        );
      })}
    </g>
  );
}

// The sky now as a picture: sun or moon, clouds, rain
export function WeatherPicture({ condition, night = false, className, title }: ArtProps & { condition: SkyCondition | null; night?: boolean }) {
  const id = useId().replace(/:/g, '');
  const body = (() => {
    switch (condition) {
      case 'clear':
        return night ? <Moon id={id} cx={50} cy={50} r={24} /> : <Sun id={id} cx={50} cy={50} r={22} />;
      case 'partlyCloudy':
        return (
          <>
            {night ? <Moon id={id} cx={38} cy={36} r={18} /> : <Sun id={id} cx={38} cy={36} r={17} />}
            <CloudShape id={id} x={60} y={64} w={62} />
          </>
        );
      case 'mostlyCloudy':
        return (
          <>
            {night ? <Moon id={id} cx={32} cy={30} r={13} /> : <Sun id={id} cx={32} cy={30} r={12} />}
            <CloudShape id={id} x={44} y={50} w={52} />
            <CloudShape id={id} x={60} y={66} w={66} />
          </>
        );
      case 'overcast':
        return (
          <>
            <CloudShape id={id} x={38} y={44} w={56} dark />
            <CloudShape id={id} x={58} y={62} w={70} />
          </>
        );
      case 'drizzle':
        return (
          <>
            <CloudShape id={id} x={50} y={42} w={74} />
            <Drops id={id} x0={30} x1={70} y={60} count={3} />
          </>
        );
      case 'rain':
        return (
          <>
            <CloudShape id={id} x={50} y={40} w={78} dark />
            <Drops id={id} x0={24} x1={76} y={58} count={5} />
          </>
        );
      case 'heavyRain':
        return (
          <>
            <CloudShape id={id} x={44} y={32} w={60} dark drift={false} />
            <CloudShape id={id} x={54} y={42} w={80} dark />
            <Drops id={id} x0={18} x1={82} y={58} count={8} heavy />
          </>
        );
      default:
        return <CloudShape id={id} x={50} y={52} w={70} />;
    }
  })();
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
}

// Wind: three streams, longer and faster with more wind
export function WindPicture({ speed, className, title }: ArtProps & { speed: number | null }) {
  const id = useId().replace(/:/g, '');
  const strength = Math.min(Math.max((speed ?? 0) / 12, 0.15), 1);
  const dur = 3 - strength * 1.8;
  const streams = [
    { y: 34, d: 'M10 34 H58 C70 34 72 20 62 18 C55 17 53 25 58 27', w: 5 },
    { y: 52, d: 'M6 52 H76 C90 52 92 70 80 72 C72 73 70 64 76 62', w: 5.5 },
    { y: 70, d: 'M18 70 H46 C55 70 56 80 49 81', w: 4.5 },
  ];
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}-wind`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.2" />
          <stop offset="60%" stopColor="#bae6fd" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      {streams.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={`url(#${id}-wind)`} strokeWidth={s.w} strokeLinecap="round" strokeDasharray="70 30">
          <animate attributeName="stroke-dashoffset" values="100;0" dur={`${dur + i * 0.3}s`} repeatCount="indefinite" />
        </path>
      ))}
    </svg>
  );
}

// A thermometer filled to how warm it is (celsius, -10 to 45 °C across the tube); hot is the track's, in red
export function ThermometerPicture({ celsius, hot = false, className, title }: ArtProps & { celsius: number | null; hot?: boolean }) {
  const id = useId().replace(/:/g, '');
  const share = celsius == null ? 0.3 : Math.min(Math.max((celsius + 10) / 55, 0.08), 1);
  const top = 18;
  const bottom = 66;
  const level = bottom - (bottom - top) * share;
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}-merc`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={hot ? '#ff3b30' : '#ff6b3d'} />
          <stop offset="100%" stopColor={hot ? '#ffb020' : '#ffd23f'} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      {hot && <path d="M64 88 C70 84 76 88 82 84 M64 78 C70 74 76 78 82 74" stroke="#ffb020" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />}
      <rect x="40" y="10" width="20" height="64" rx="10" fill={`url(#${id}-glass)`} stroke="#e2e8f0" strokeOpacity="0.7" strokeWidth="2.5" />
      <rect x="45" y={level} width="10" height={bottom - level + 8} rx="5" fill={`url(#${id}-merc)`} />
      <circle cx="50" cy="78" r="13" fill={`url(#${id}-merc)`} stroke="#e2e8f0" strokeOpacity="0.7" strokeWidth="2.5" />
      <circle cx="46" cy="74" r="3.5" fill="#fff" opacity="0.55" />
      {[24, 36, 48, 60].map((y) => (
        <line key={y} x1="62" x2="68" y1={y} y2={y} stroke="#e2e8f0" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
      ))}
    </svg>
  );
}

// A water drop, filled to the humidity (0-1)
export function HumidityPicture({ humidity, className, title }: ArtProps & { humidity: number | null }) {
  const id = useId().replace(/:/g, '');
  const share = Math.min(Math.max(humidity ?? 0, 0), 1);
  const drop = 'M50 10 C50 10 22 44 22 62 C22 78 35 90 50 90 C65 90 78 78 78 62 C78 44 50 10 50 10 Z';
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={drop} />
        </clipPath>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7cc7ff" />
          <stop offset="100%" stopColor="#1d6fe0" />
        </linearGradient>
      </defs>
      <path d={drop} fill="#ffffff" fillOpacity="0.08" stroke="#bfe3ff" strokeOpacity="0.8" strokeWidth="3" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y={90 - 80 * share} width="100" height="100" fill={`url(#${id}-water)`} />
        <path d={`M0 ${90 - 80 * share} Q25 ${86 - 80 * share} 50 ${90 - 80 * share} T100 ${90 - 80 * share}`} fill="none" stroke="#e0f2fe" strokeOpacity="0.7" strokeWidth="2">
          <animateTransform attributeName="transform" type="translate" values="-10 0; 10 0; -10 0" dur="4s" repeatCount="indefinite" />
        </path>
      </g>
      <path d="M36 54 C36 46 40 40 44 35" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

// The wind's direction: an arrow pointing where it blows to, inside a compass ring
export function WindCompass({ fromRadians, label, className }: { fromRadians: number | null; label?: string | null; className?: string }) {
  const id = useId().replace(/:/g, '');
  const deg = fromRadians == null ? null : ((((fromRadians * 180) / Math.PI) % 360) + 360) % 360;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${id}-ring`}>
          <stop offset="70%" stopColor="#0f1722" />
          <stop offset="100%" stopColor="#1e2a3a" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-ring)`} stroke="#3b4a5e" strokeWidth="2" />
      {Array.from({ length: 16 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="7"
          x2="50"
          y2={i % 4 === 0 ? 15 : 11}
          stroke={i === 0 ? '#e10600' : '#64748b'}
          strokeWidth={i % 4 === 0 ? 3 : 1.5}
          transform={`rotate(${i * 22.5} 50 50)`}
        />
      ))}
      <text x="50" y="27" textAnchor="middle" fontSize="11" fontWeight="700" fill="#cbd5e1">
        N
      </text>
      {deg != null && (
        // a wind from the north blows to the south: the arrow points down
        <g transform={`rotate(${deg + 180} 50 50)`}>
          <path d="M50 22 L60 50 L50 45 L40 50 Z" fill="#38bdf8" />
          <path d="M50 78 L56 50 L50 54 L44 50 Z" fill="#334155" />
        </g>
      )}
      <circle cx="50" cy="50" r="4" fill="#e2e8f0" />
      {label && (
        <text x="50" y="90" textAnchor="middle" fontSize="10" fontWeight="700" fill="#94a3b8">
          {label}
        </text>
      )}
    </svg>
  );
}
