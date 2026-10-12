'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChartNoAxesCombined, Flag, Gauge, GitCompareArrows, MapPin, Sparkles, Upload, X } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { useUnits } from '@/components/UnitsProvider';
import { DISTANCE_UNIT, distanceFromFeet, SPEED_UNIT, speedFromMph } from '@/lib/units';

// Landing page preview of the Racing toolkit. Everything here is sample data;
// nothing is sent to the real analysis APIs.

// Icons for the dictionary's workbench.tools, in the same order
const toolIcons = [GitCompareArrows, Sparkles, ChartNoAxesCombined, MapPin, Gauge, Flag];
const LAP_COMPARE = 0, DEBRIEF = 1, TRENDS = 2, FOCUS_AREAS = 3, RACECAR = 4, STINT = 5;

const tracks = ['Mobility Resort Motegi (Grand Prix)', 'Circuit Zandvoort', 'Spa-Francorchamps'];

// Focus area, start – end, brake point (feet), max brake, on throttle (feet); shown in the user's units
type FocusRow = [string, string, number | null, string, number | null];
const focusRows: FocusRow[] = [
  ['T 1 & 2', '0.02 – 0.09', 511, '79%', 1008],
  ['T 3 & 4', '0.16 – 0.25', 3163, '86%', null],
  ['T 5', '0.31 – 0.36', 5019, '84%', 5463],
  ['T 7', '0.44 – 0.52', 7190, '68%', 7621],
  ['T 9', '0.54 – 0.58', 8711, '76%', 9034],
  ['T 10', '0.63 – 0.69', 10129, '86%', 10488],
];

// Focus area, time difference, feet braked earlier, minimum speed difference (mph)
const comparisonRows: [string, string, number, number][] = [
  ['T 1 & 2', '−0.016s', 58, 2],
  ['T 5', '+0.123s', 29, -2],
  ['T 9', '−0.061s', 4, 0],
  ['T 10', '+0.023s', 139, 0],
];

// The Lap Compare chart's distance axis
const AXIS_METERS = [0, 1000, 2000, 3000, 4000];
const AXIS_FEET = [0, 3000, 6000, 9000, 12000];

// Paired with the dictionary's workbench.sampleCars descriptions
const sampleCars = ['Porsche 911 GT3 R', 'Ferrari 296 GT3', 'BMW M4 GT3 EVO'];

function TelemetryChart({ trend = false, stint = false }: { trend?: boolean; stint?: boolean }) {
  const { t, fmt, locale } = useLanguage();
  const units = useUnits();
  const pace = '35,60 60,59 79,62 95,126 112,150 133,123 149,78 172,55 192,60 207,96 223,144 239,130 255,58 283,48 300,69 315,156 333,138 351,99 370,52 399,50 412,93 430,157 450,141 471,72 497,48 516,56 530,110 549,132 570,58';
  const ratings = '35,150 59,158 82,148 106,165 133,150 150,126 174,134 191,108 212,117 237,91 253,121 272,98 292,105 313,72 333,84 354,70 379,89 399,67 420,60 442,76 463,43 483,56 501,35 521,48 546,40 570,51';
  const label = trend ? t.workbench.chartLabelTrend : stint ? t.workbench.chartLabelStint : t.workbench.chartLabelCompare;
  const axis = trend
    ? t.workbench.months
    : stint
      ? [2, 4, 6, 8, 10].map((n) => fmt(t.workbench.lapN, { n }))
      : (units === 'metric' ? AXIS_METERS : AXIS_FEET).map((n) => `${n.toLocaleString(locale)} ${DISTANCE_UNIT[units]}`);

  return (
    <div className="chart-box">
      <svg className="chart-svg" viewBox="0 0 600 190" role="img" aria-label={label}>
        {[30, 70, 110, 150].map((y, i) => (
          <g key={y}>
            <line x1="35" x2="580" y1={y} y2={y} className="chart-grid" />
            <text x="2" y={y + 3} className="chart-text">{trend ? 2500 - i * 500 : stint ? `${113 - i}s` : 160 - i * 40}</text>
          </g>
        ))}
        {!trend && <polyline points={pace} className="chart-reference" transform={stint ? 'translate(0 14) scale(1 .65)' : 'translate(0 -9)'} />}
        <polyline points={trend ? ratings : pace} className="chart-line" transform={stint ? 'translate(0 25) scale(1 .65)' : undefined} />
      </svg>
      <div className="chart-axis">{axis.map((x) => <span key={x}>{x}</span>)}</div>
    </div>
  );
}

function Insight({ title, tag, gain, children }: { title?: string; tag?: string; gain?: string; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="insight">
      <span className="insight-tag">{tag ?? t.workbench.priorityFocus}</span>
      <h4>{title ?? t.workbench.insightTitle}</h4>
      <p>{children}</p>
      <span className="insight-gain">{gain ?? t.workbench.insightGain}</span>
    </div>
  );
}

function TrackSelect({ value, onChange, label }: { value: string; onChange: (track: string) => void; label: string }) {
  return (
    <select className="track-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {tracks.map((track) => <option key={track}>{track}</option>)}
    </select>
  );
}

export default function CoachingWorkbench() {
  const { t: dictionary, fmt, plural, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.workbench;
  // Sample feet and mph in the user's units: "1,008 ft" / "307 m", "+2 mph" / "+3 kph"
  const distance = (feet: number) => Math.round(distanceFromFeet(feet, units)).toLocaleString(locale);
  const speed = (mph: number) => {
    const value = Math.round(speedFromMph(mph, units));
    return `${value < 0 ? '−' : '+'}${Math.abs(value)} ${SPEED_UNIT[units]}`;
  };
  const sampleSpeed = (mph: number) => `${speedFromMph(mph, units).toLocaleString(locale, { maximumFractionDigits: 1 })} ${SPEED_UNIT[units]}`;
  const [active, setActive] = useState(LAP_COMPARE);
  const [track, setTrack] = useState(tracks[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [question, setQuestion] = useState(t.defaultQuestion);
  const [answer, setAnswer] = useState(false);
  const [newArea, setNewArea] = useState('');
  const [areas, setAreas] = useState(focusRows);
  const input = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]) {
    const selected = Array.from(incoming);
    const valid = selected.filter((file) => file.name.toLowerCase().endsWith('.csv') && file.size <= 25 * 1024 * 1024);
    setFiles((prev) => [...prev, ...valid]);
    setMessage(valid.length !== selected.length ? t.tooLarge : plural(valid.length, t.filesAdded));
  }

  function footerAction() {
    if (active === LAP_COMPARE) setShowDetails(!showDetails);
    else if (active === DEBRIEF) { setReviewed(true); setMessage(t.sampleDebriefShown); }
    else if (active === TRENDS) setMessage(t.syncNotConnected);
    else if (active === STINT) setMessage(t.sampleStint);
    else { setActive(LAP_COMPARE); setShowDetails(false); }
  }

  const footerLabel = active === LAP_COMPARE ? (showDetails ? t.hideComparison : t.exploreComparison)
    : active === DEBRIEF ? t.previewDebrief
    : active === TRENDS ? t.syncIRacing
    : active === STINT ? t.reviewStint
    : t.exploreComparison;

  const [statLabels, statValues] = active === TRENDS ? [t.statsTrend, ['1,991', '3.42', 'P8']]
    : active === STINT ? [t.statsStint, ['1:49.331', '±0.42s', '6 / 8']]
    : [t.statsCompare, ['1:50.056', '1:49.410', '0.646s']];

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
              onClick={() => { setActive(index); setMessage(''); setShowDetails(false); }}
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

        {(active === LAP_COMPARE || active === TRENDS || active === STINT) && (
          <div className="workspace-grid">
            <div>
              <div className="chart-top">
                <TrackSelect label={t.track} value={track} onChange={setTrack} />
                <div className="chart-legend">
                  <span><i className="legend-dot" />{active === TRENDS ? t.iRating : active === STINT ? t.lapTime : t.yourLap}</span>
                  {active !== TRENDS && <span><i className="legend-dot reference" />{t.reference}</span>}
                </div>
              </div>
              <TelemetryChart trend={active === TRENDS} stint={active === STINT} />
              <div className="lap-summary">
                {statLabels.map((label, i) => (
                  <div key={label}>
                    <span className="stat-label">{label}</span>
                    <strong className={`stat-value ${i === 2 ? 'stat-positive' : ''}`}>{statValues[i]}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="insight-heading"><Sparkles />{t.coachInsight}</div>
              {active === TRENDS ? (
                <>
                  <Insight title={t.trendUpTitle} gain={t.trendUpGain}>
                    {t.trendUpCopy}
                  </Insight>
                  <Insight tag={t.nextUp} title={t.consistencyTitle} gain={t.consistencyGain}>
                    {t.consistencyCopy}
                  </Insight>
                </>
              ) : (
                <>
                  <Insight title={active === STINT ? t.stintTitle : undefined}>
                    {active === STINT ? t.stintCopy : fmt(t.apexCopy, { fast: sampleSpeed(42.3) })}
                  </Insight>
                  <Insight tag={t.nextUp} title={t.brakingTitle} gain={t.brakingGain}>
                    {t.brakingCopy}
                  </Insight>
                </>
              )}
            </div>
          </div>
        )}

        {active === DEBRIEF && (
          <div className="workspace-grid">
            <div>
              <div
                className="upload-zone"
                data-dragging={dragging}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              >
                <Upload />
                <p>{t.dropFiles}</p>
                <small>{t.fileRules}</small>
                <Button variant="outline" onClick={() => input.current?.click()}>{t.browseFiles} <ArrowRight /></Button>
                <input
                  ref={input}
                  type="file"
                  accept=".csv"
                  multiple
                  hidden
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
              {files.map((file, i) => (
                <div className="file-row" key={`${file.name}-${i}`}>
                  <span>{file.name}</span>
                  <Button variant="ghost" size="icon" aria-label={fmt(t.removeFile, { name: file.name })} onClick={() => setFiles((prev) => prev.filter((_, index) => index !== i))}><X /></Button>
                </div>
              ))}
              <p className="status-message" role="status">{message}</p>
            </div>
            <div>
              <div className="insight-heading"><Sparkles />{reviewed ? t.sampleDebrief : t.debriefPreview}</div>
              <Insight>{fmt(t.debriefCopy, { fast: sampleSpeed(42.3), slow: sampleSpeed(39.8) })}</Insight>
              <p className="analysis-note">{t.debriefNote}</p>
            </div>
          </div>
        )}

        {active === FOCUS_AREAS && (
          <>
            <div className="chart-top">
              <TrackSelect label={t.focusAreaTrack} value={track} onChange={setTrack} />
              <span className="stat-label">{plural(areas.length, t.sampleAreas)}</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>{[...t.focusColumns, ''].map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {areas.map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j}>{typeof v === 'number' ? `${distance(v)} ${DISTANCE_UNIT[units]}` : v ?? '—'}</td>
                      ))}
                      <td>
                        <Button variant="ghost" size="icon" aria-label={fmt(t.deleteArea, { name: row[0] })} onClick={() => setAreas((prev) => prev.filter((_, idx) => idx !== i))}><X /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              className="question-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (newArea.trim()) { setAreas((prev) => [...prev, [newArea.trim(), '—', null, '—', null]]); setNewArea(''); }
              }}
            >
              <input className="text-input" value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder={t.newAreaName} aria-label={t.newAreaName} required />
              <Button type="submit">{t.addArea} <MapPin /></Button>
            </form>
            <p className="analysis-note">{t.focusNote}</p>
          </>
        )}

        {active === RACECAR && (
          <>
            <form className="question-form" onSubmit={(e) => { e.preventDefault(); if (question.trim()) setAnswer(true); }}>
              <input className="text-input" aria-label={t.racecarQuestion} value={question} onChange={(e) => { setQuestion(e.target.value); setAnswer(false); }} required />
              <Button type="submit"><Sparkles />{t.previewAnalysis}</Button>
            </form>
            {answer ? (
              <>
                <p className="analysis-note">{t.racecarIllustrative}</p>
                {sampleCars.map((car, i) => (
                  <div className="car-result" key={car}>
                    <div className="car-result-main">
                      <span className="rank">0{i + 1}</span>
                      <div><strong>{car}</strong><p>{t.sampleCars[i]}</p></div>
                    </div>
                    <Gauge className="text-muted-foreground" />
                  </div>
                ))}
              </>
            ) : (
              <div className="analysis-note">{t.racecarIntro}</div>
            )}
          </>
        )}

        {showDetails && active === LAP_COMPARE && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{t.compareColumns.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {comparisonRows.map(([area, time, feet, mph]) => (
                  <tr key={area}>
                    <td>{area}</td>
                    <td>{time}</td>
                    <td>{fmt(t.distanceEarlier, { n: distance(feet), unit: DISTANCE_UNIT[units] })}</td>
                    <td>{speed(mph)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel-footer">
          <p>{t.footer}</p>
          <Button size="sm" variant={showDetails ? 'outline' : 'default'} onClick={footerAction}>{footerLabel}<ArrowRight /></Button>
        </div>
        {message && active !== DEBRIEF && <p className="status-message" role="status">{message}</p>}
      </div>
    </>
  );
}
