'use client';

import { Radar } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { WeatherPicture } from '@/components/WeatherArt';
import { isNight, skyCondition, type LiveWeather } from '@/lib/liveWeather';

// The weather radar the TV and the Live Racing page switch to for a few seconds of every minute while it's wet
// (radarShowing in src/lib/liveCarStatus.ts). iRacing gives one rain reading for the track (Precipitation, at the
// start/finish line) and the wind, not a map of where the rain is, so the radar draws rain cells as heavy and as many
// as that reading says, drifting the way the wind blows, over the track's map (left showing through underneath) with
// a sweeping beam; the note under it says so. It fades in and out with visible, and draws nothing while hidden.

type Cell = { x: number; y: number; r: number; strength: number; blobs: { dx: number; dy: number; r: number }[] };

// A small seeded random, so a session's cells don't jump about between renders
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCells(rain: number, seed: number): Cell[] {
  const random = seeded(seed);
  const count = rain <= 0.02 ? 0 : Math.round(5 + rain * 26);
  return Array.from({ length: count }, () => {
    const r = 0.06 + random() * (0.08 + rain * 0.12);
    return {
      x: random(),
      y: random(),
      r,
      strength: Math.min(1, rain * (0.55 + random() * 0.9)),
      blobs: Array.from({ length: 4 + Math.floor(random() * 5) }, () => ({
        dx: (random() - 0.5) * r * 1.6,
        dy: (random() - 0.5) * r * 1.6,
        r: r * (0.35 + random() * 0.55),
      })),
    };
  });
}

// The radar's returns are drawn in squares this many CSS pixels across
const ECHO_PIXEL = 6;

// Radar reflectivity colors: light green to heavy red
function echoColor(strength: number): [number, number, number] {
  if (strength < 0.25) return [34, 197, 94];
  if (strength < 0.45) return [163, 230, 53];
  if (strength < 0.62) return [250, 204, 21];
  if (strength < 0.8) return [249, 115, 22];
  return [239, 68, 68];
}

export default function WeatherRadar({
  weather,
  wetTires,
  visible,
  size = 'page',
}: {
  weather: LiveWeather | null;
  wetTires: boolean;
  visible: boolean;
  size?: 'page' | 'tv';
}) {
  const { t, fmt } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rain = weather?.precipitation ?? 0;
  const windSpeed = weather?.windSpeed ?? 0;
  const windDir = weather?.windDir ?? null;
  // rounded, so small changes in the reading don't redraw the cells
  const rainStep = Math.round(rain * 20) / 20;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cells = makeCells(rainStep, 7919 + Math.round(rainStep * 100));
    // where the wind blows to, in screen terms (north up), and how fast the cells cross the screen
    const toRad = windDir == null ? Math.PI / 4 : windDir + Math.PI;
    const drift = 0.004 + Math.min(windSpeed, 25) * 0.0016;
    const vx = Math.sin(toRad) * drift;
    const vy = -Math.cos(toRad) * drift;
    const echoes = document.createElement('canvas');
    const ectx = echoes.getContext('2d');
    if (!ectx) return;
    const started = performance.now();
    let id = 0;

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const time = (now - started) / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.hypot(w, h) / 2;
      const span = Math.max(w, h);

      // the screen: dark green glass over the map
      const glass = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glass.addColorStop(0, 'rgba(4, 30, 18, 0.35)');
      glass.addColorStop(1, 'rgba(1, 10, 6, 0.78)');
      ctx.fillStyle = glass;
      ctx.fillRect(0, 0, w, h);

      // rain cells, drifting with the wind and wrapping round, drawn at a coarse resolution and scaled up without
      // smoothing, so they come back as a radar's blocky returns (and cost a TV little)
      const lw = Math.max(1, Math.ceil(w / ECHO_PIXEL));
      const lh = Math.max(1, Math.ceil(h / ECHO_PIXEL));
      if (echoes.width !== lw || echoes.height !== lh) {
        echoes.width = lw;
        echoes.height = lh;
      }
      ectx.setTransform(1, 0, 0, 1, 0, 0);
      ectx.clearRect(0, 0, lw, lh);
      ectx.setTransform(1 / ECHO_PIXEL, 0, 0, 1 / ECHO_PIXEL, 0, 0);
      for (const cell of cells) {
        const px = (((cell.x + vx * time) % 1) + 1) % 1;
        const py = (((cell.y + vy * time) % 1) + 1) % 1;
        const [r, g, b] = echoColor(cell.strength);
        for (const blob of cell.blobs) {
          const bx = (px - 0.5) * span * 1.2 + cx + blob.dx * span;
          const by = (py - 0.5) * span * 1.2 + cy + blob.dy * span;
          const br = blob.r * span;
          const grad = ectx.createRadialGradient(bx, by, 0, bx, by, br);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.6 + cell.strength * 0.3})`);
          grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${0.35 + cell.strength * 0.25})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ectx.fillStyle = grad;
          ectx.beginPath();
          ectx.arc(bx, by, br, 0, Math.PI * 2);
          ectx.fill();
          // a heavier core inside the stronger cells
          if (cell.strength > 0.5) {
            const [cr, cg, cb] = echoColor(Math.min(1, cell.strength + 0.3));
            const core = ectx.createRadialGradient(bx, by, 0, bx, by, br * 0.45);
            core.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.85)`);
            core.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
            ectx.fillStyle = core;
            ectx.beginPath();
            ectx.arc(bx, by, br * 0.45, 0, Math.PI * 2);
            ectx.fill();
          }
        }
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(echoes, 0, 0, lw * ECHO_PIXEL, lh * ECHO_PIXEL);
      ctx.imageSmoothingEnabled = true;

      // range rings and crosshairs
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.28)';
      ctx.lineWidth = 1;
      const ring = Math.min(w, h) / 2;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (ring * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // the beam: a bright edge and a fading trail behind it, one turn every 4 s
      const angle = ((time / 4) % 1) * Math.PI * 2 - Math.PI / 2;
      const steps = 36;
      for (let i = 0; i < steps; i++) {
        const a0 = angle - (i + 1) * 0.025;
        const a1 = angle - i * 0.025;
        ctx.fillStyle = `rgba(74, 222, 128, ${0.22 * (1 - i / steps) ** 2})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(134, 239, 172, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.stroke();

      // the track, pulsing at the middle
      const pulse = (time % 1.6) / 1.6;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [visible, rainStep, windSpeed, windDir]);

  const tv = size === 'tv';
  const sky = weather ? skyCondition(weather) : null;
  const compass =
    windDir != null ? t.weather.compass[Math.round(((((windDir + Math.PI) * 180) / Math.PI) % 360 + 360) % 360 / 45) % 8] : null;
  const legend = [
    [t.carWeather.radarLight, '#22c55e'],
    [t.carWeather.radarModerate, '#facc15'],
    [t.carWeather.radarHeavy, '#ef4444'],
  ] as const;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit] transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden={!visible}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className={`absolute left-0 right-0 top-0 flex items-start justify-between ${tv ? 'p-6' : 'p-3'}`}>
        <div className={`flex items-center gap-3 rounded-xl bg-black/65 backdrop-blur-sm ${tv ? 'px-5 py-3' : 'px-3 py-2'} ring-1 ring-green-400/40`}>
          <Radar className={`${tv ? 'size-10' : 'size-6'} text-green-400`} aria-hidden />
          <div>
            <p className={`font-display font-bold uppercase tracking-wider text-green-300 ${tv ? 'text-[34px] leading-none' : 'text-base leading-none'}`}>
              {t.carWeather.radar}
            </p>
            <p className={`mt-1 text-white ${tv ? 'text-[22px]' : 'text-xs'}`}>
              {rain > 0.02 ? fmt(t.carWeather.radarRain, { n: Math.round(rain * 100) }) : t.carWeather.radarNoRain}
              {compass && rain > 0.02 && <span className="text-green-200"> · {fmt(t.carWeather.radarMoving, { dir: compass })}</span>}
              {wetTires && <span className="text-sky-300"> · {t.carWeather.radarWetTires}</span>}
            </p>
          </div>
        </div>
        {sky && <WeatherPicture condition={sky} night={weather ? isNight(weather) : false} className={`${tv ? 'size-28' : 'size-14'} drop-shadow-lg`} />}
      </div>
      <div className={`absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 ${tv ? 'p-6' : 'p-3'}`}>
        <div className={`flex items-center gap-3 rounded-lg bg-black/65 ${tv ? 'px-4 py-2 text-[20px]' : 'px-2.5 py-1.5 text-[11px]'} text-white`}>
          {legend.map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={`${tv ? 'h-3 w-8' : 'h-2 w-5'} rounded-full`} style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
        <p className={`min-w-0 truncate rounded-lg bg-black/55 text-right text-white/80 ${tv ? 'whitespace-nowrap px-4 py-2 text-[17px]' : 'px-2 py-1 text-[10px]'}`}>{t.carWeather.radarNote}</p>
      </div>
    </div>
  );
}
