'use client';

import { useState, type ReactNode } from 'react';
import { GitCompareArrows, MapPin, RotateCw, Sparkles, Thermometer, Timer } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import {
  DISTANCE_UNIT, MASS_UNIT, RIDE_HEIGHT_UNIT, SPEED_UNIT, TEMPERATURE_UNIT,
  distanceFromFeet, distanceFromMeters, massFromKg, rideHeightFromMeters, roundBrakeChange,
  speedFromMetersPerSecond, speedFromMph, temperatureFromCelsius,
} from '@/lib/units';

// Landing page preview of the Racing toolkit. Everything here is sample data;
// nothing is sent to the real analysis APIs.

// Icons for the dictionary's workbench.tools, in the same order
const toolIcons = [GitCompareArrows, Sparkles, Timer, Thermometer, MapPin, RotateCw];
const COMPARE = 0, DEBRIEF = 1, STINT = 2, ADVANCED = 3, FOCUS_AREAS = 4, CAR_DATA = 5;

// Steering samples (degrees, + = left) across the focus area, and the reference lap's
const steer = [2, 6, 12, 22, 38, 55, 72, 84, 86, 80, 64, 42, 20, 4, -12, -28, -40, -46, -38, -22, -6, 8, 24, 40, 52, 44, 26, 10];
const steerReference = steer.map((v, i) => v + Math.round(Math.sin(i) * 5));
const steerY = (v: number) => 95 - v * 0.65;
const STEER_STEP = 560 / (steer.length - 1);
// Where the focus area starts, and the meters between samples
const STEER_START_METERS = 1600, STEER_SAMPLE_METERS = 15;

// Focus area, start – end, brake point (feet), max brake, on throttle (feet); shown in the user's units
const focusRows: [string, string, number, string, number | null][] = [
  ['T 1 & 2', '0.02 – 0.09', 511, '79%', 1008],
  ['T 3 & 4', '0.16 – 0.25', 3163, '86%', null],
  ['T 5', '0.31 – 0.36', 5019, '84%', 5463],
  ['T 7', '0.44 – 0.52', 7190, '68%', 7621],
  ['T 10', '0.63 – 0.69', 10129, '86%', 10488],
];

// Lap, time, sectors, gap to the target lap (the first row is the target)
const stintRows = [
  [3, '1:49.331', '32.10', '41.02', '36.21', ''],
  [4, '1:49.702', '32.18', '41.30', '36.22', '+0.371'],
  [5, '1:50.115', '32.41', '41.44', '36.27', '+0.784'],
  [6, '1:49.520', '32.12', '41.19', '36.21', '+0.189'],
] as const;

// Each tire's outer / middle / inner temperature and its difference from the reference lap, °C
const tireTemps: [number[], number][] = [
  [[60.7, 66.3, 71.1], -1.1],
  [[66.5, 68.7, 74.3], -6.0],
  [[62.4, 64.0, 66.8], -1.9],
  [[65.1, 67.2, 69.9], -5.4],
];

// Each corner's ride height and its difference from the reference lap, mm
const rideHeights: [number, number][] = [[54, -3], [53, -4], [71, 1], [70, 1]];

// iRacing's fuel density when session info has none, kg per liter
const FUEL_KG_PER_LITER = 0.75;

function Insight({ tag, title, gain, children }: { tag: string; title: string; gain?: string; children: ReactNode }) {
  return (
    <div className="insight">
      <span className="insight-tag">{tag}</span>
      <h4>{title}</h4>
      <p>{children}</p>
      {gain && <span className="insight-gain">{gain}</span>}
    </div>
  );
}

// A row of stats; the last one is shown as a gain
function Stats({ labels, values }: { labels: string[]; values: string[] }) {
  return (
    <div className="lap-summary" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((label, i) => (
        <div key={label}>
          <span className="stat-label">{label}</span>
          <strong className={`stat-value ${i === labels.length - 1 ? 'stat-positive' : ''}`}>{values[i]}</strong>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Compare Lap: the steering wheel turns with the lap as the mouse moves across the chart
function SteeringDemo() {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.workbench;
  const [index, setIndex] = useState(8);
  const angle = steer[index], reference = steerReference[index];
  const side = (v: number) => `${Math.abs(v)}° ${v >= 0 ? t.left : t.right}`;
  const position = Math.round(distanceFromMeters(STEER_START_METERS + index * STEER_SAMPLE_METERS, units)).toLocaleString(locale);

  return (
    <div className="steer-demo">
      <div className="steer-wheel-wrap">
        <svg viewBox="0 0 120 120" className="steer-wheel" style={{ transform: `rotate(${-angle}deg)` }} aria-hidden="true">
          <circle cx="60" cy="60" r="50" className="wheel-rim" />
          <rect x="42" y="45" width="36" height="30" rx="5" className="wheel-hub" />
          <line x1="12" y1="60" x2="42" y2="60" className="wheel-spoke" />
          <line x1="78" y1="60" x2="108" y2="60" className="wheel-spoke" />
          <line x1="60" y1="75" x2="60" y2="108" className="wheel-spoke" />
          <rect x="57" y="8" width="6" height="8" className="wheel-mark" />
        </svg>
        <div className="steer-readout">
          <span><i className="legend-dot" />{side(angle)} {t.yourLap}</span>
          <span><i className="legend-dot reference" />{side(reference)} {t.reference}</span>
          <small>{position} {DISTANCE_UNIT[units]}</small>
        </div>
      </div>
      <div className="chart-box">
        <svg
          className="chart-svg"
          viewBox="0 0 600 190"
          role="img"
          aria-label={t.steeringLabel}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 600 - 30;
            setIndex(Math.max(0, Math.min(steer.length - 1, Math.round(x / STEER_STEP))));
          }}
        >
          {[30, 95, 160].map((y, i) => (
            <g key={y}>
              <line x1="30" x2="590" y1={y} y2={y} className="chart-grid" />
              <text x="0" y={y + 3} className="chart-text">{[`100°${t.left}`, '0°', `100°${t.right}`][i]}</text>
            </g>
          ))}
          <polyline points={steerReference.map((v, i) => `${30 + i * STEER_STEP},${steerY(v)}`).join(' ')} className="chart-reference" />
          <polyline points={steer.map((v, i) => `${30 + i * STEER_STEP},${steerY(v)}`).join(' ')} className="chart-line" />
          <line x1={30 + index * STEER_STEP} x2={30 + index * STEER_STEP} y1="20" y2="170" className="chart-cursor" />
        </svg>
        <p className="analysis-note">{t.steeringNote}</p>
      </div>
    </div>
  );
}

// Advanced Analysis: balance, tire temperatures, ride heights and engine, in the user's units
function Advanced() {
  const { t: dictionary, fmt, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.workbench;
  const [tab, setTab] = useState(1);
  const number = (value: number, digits = 0) =>
    value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value: number, digits = 0) => `${value < 0 ? '−' : '+'}${number(Math.abs(value), digits)}`;
  const temperature = (celsius: number, digits = 0) => number(temperatureFromCelsius(celsius, units), digits);
  // A temperature difference has no offset: only °C to °F's scale
  const temperatureDelta = (celsius: number, digits = 0) => signed(units === 'metric' ? celsius : (celsius * 9) / 5, digits);
  const rideDigits = units === 'metric' ? 0 : 2;
  const ride = (mm: number) => rideHeightFromMeters(mm / 1000, units);
  const fuel = (liters: number) => massFromKg(liters * FUEL_KG_PER_LITER, units);

  const rows: ReactNode[][][] = [
    [
      [t.corners[0], t.understeer, '+1.8°', fmt(t.frontSlip, { n: number(6.1, 1) })],
      [t.corners[1], t.neutral, '+0.3°', fmt(t.frontSlip, { n: number(4.2, 1) })],
      [t.corners[2], t.oversteer, '−2.4°', fmt(t.rearSlip, { n: number(8.7, 1) })],
    ],
    tireTemps.map(([temps, delta], i) => [
      t.tires[i],
      `${temps.map((c) => temperature(c, 1)).join(' / ')} ${TEMPERATURE_UNIT[units]}`,
      `${temperatureDelta(delta, 1)} ${TEMPERATURE_UNIT[units]}`,
      i < 2 ? t.innerHot : t.balanced,
    ]),
    rideHeights.map(([mm, delta], i) => [
      t.rideCorners[i],
      `${number(ride(mm), rideDigits)} ${RIDE_HEIGHT_UNIT[units]}`,
      `${signed(ride(delta), rideDigits)} ${RIDE_HEIGHT_UNIT[units]}`,
      i === 0 ? t.kerbStrike : '—',
    ]),
    [
      [t.engineRows[0], `${temperature(104)} ${TEMPERATURE_UNIT[units]}`, `${temperatureDelta(2)} ${TEMPERATURE_UNIT[units]}`, t.normal],
      [t.engineRows[1], `${temperature(88)} ${TEMPERATURE_UNIT[units]}`, `${temperatureDelta(1)} ${TEMPERATURE_UNIT[units]}`, t.normal],
      [t.engineRows[2], `${number(fuel(2.84), 2)} ${MASS_UNIT[units]}`, `${signed(fuel(-0.06), 2)} ${MASS_UNIT[units]}`, t.saving],
    ],
  ];
  const head = t.advancedColumns.map((h, i) => (i === 1 && tab === 1 ? t.tireColumn : h));

  return (
    <>
      <div className="sub-tabs" role="tablist" aria-label={t.advancedLabel}>
        {t.advancedTabs.map((name, i) => (
          <button key={name} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>{name}</button>
        ))}
      </div>
      <Table head={head} rows={rows[tab]} />
    </>
  );
}

export default function CoachingWorkbench() {
  const { t: dictionary, fmt, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.workbench;
  const [active, setActive] = useState(COMPARE);
  // Sample distances and speeds in the user's units: "1,008 ft" / "307 m", "42.3 mph" / "68.1 kph"
  const feet = (value: number) => `${Math.round(distanceFromFeet(value, units)).toLocaleString(locale)} ${DISTANCE_UNIT[units]}`;
  const brakeChange = (meters: number) => `${roundBrakeChange(distanceFromMeters(meters, units), units)} ${DISTANCE_UNIT[units]}`;
  const speed = (mph: number) => `${speedFromMph(mph, units).toLocaleString(locale, { maximumFractionDigits: 1 })} ${SPEED_UNIT[units]}`;
  const temperature = (celsius: number) => `${Math.round(temperatureFromCelsius(celsius, units))} ${TEMPERATURE_UNIT[units]}`;

  return (
    <>
      <div className="tool-tabs" role="tablist" aria-label={t.toolsLabel}>
        {t.tools.map((tool, index) => {
          const Icon = toolIcons[index];
          return (
            <Button
              key={tool.name}
              variant="ghost"
              role="tab"
              id={`tool-tab-${index}`}
              aria-controls="coaching-panel"
              aria-selected={active === index}
              onClick={() => setActive(index)}
            >
              <Icon size={15} />{tool.name}
            </Button>
          );
        })}
      </div>

      <div className="workbench" role="tabpanel" id="coaching-panel" aria-labelledby={`tool-tab-${active}`}>
        <div className="workspace-heading">
          <div>
            <h3>{t.tools[active].name}</h3>
            <p>{t.tools[active].description}</p>
          </div>
          <span className="demo-badge">{t.preview}</span>
        </div>

        {active === COMPARE && (
          <>
            <SteeringDemo />
            <Stats labels={t.statsCompare} values={['2:09.383', '2:08.850', '0.533s']} />
          </>
        )}

        {active === DEBRIEF && (
          <div className="workspace-grid">
            <div>
              <Insight tag={t.priorityFocus} title={t.apexTitle} gain={t.apexGain}>
                {fmt(t.apexCopy, { brake: brakeChange(15), speed: speed(42.3) })}
              </Insight>
              <Insight tag={t.nextUp} title={t.exitTitle} gain={t.exitGain}>
                {fmt(t.exitCopy, { distance: brakeChange(6) })}
              </Insight>
            </div>
            <div>
              <Insight tag={t.consistency} title={t.brakeTitle} gain={t.brakeGain}>
                {fmt(t.brakeCopy, { distance: `${roundBrakeChange(distanceFromFeet(29, units), units)} ${DISTANCE_UNIT[units]}` })}
              </Insight>
              <p className="analysis-note">{t.debriefNote}</p>
            </div>
          </div>
        )}

        {active === STINT && (
          <>
            <Stats labels={t.statsStint} values={[temperature(34), temperature(24), t.conditions, '1:49.331']} />
            <Table
              head={t.stintColumns}
              rows={stintRows.map(([lap, ...rest]) => [fmt(t.lapN, { n: lap }), ...rest.slice(0, 4), rest[4] || t.target])}
            />
            <p className="analysis-note">{t.stintNote}</p>
          </>
        )}

        {active === ADVANCED && <Advanced />}

        {active === FOCUS_AREAS && (
          <Table
            head={t.focusColumns}
            rows={focusRows.map(([area, range, brake, maxBrake, throttle]) => [area, range, feet(brake), maxBrake, throttle === null ? '—' : feet(throttle)])}
          />
        )}

        {active === CAR_DATA && (
          <div className="workspace-grid">
            <div>
              <Table
                head={[t.carData, 'Porsche 911 GT3 R']}
                rows={[
                  [t.carDataRows[0], '565 hp'],
                  [t.carDataRows[1], `${Math.round(massFromKg(1260, units)).toLocaleString(locale)} ${MASS_UNIT[units]}`],
                  [t.carDataRows[2], `${Math.round(speedFromMetersPerSecond(292 / 3.6, units))} ${SPEED_UNIT[units]}`],
                  [t.carDataRows[3], t.drivetrain],
                ]}
              />
            </div>
            <div>
              <div className="insight-heading"><RotateCw />{t.rotationHeading}</div>
              <Insight tag={t.calibrated} title={t.rotationTitle} gain={t.rotationGain}>{t.rotationCopy}</Insight>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
