'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChartNoAxesCombined, Flag, Gauge, GitCompareArrows, MapPin, Sparkles, Upload, X } from 'lucide-react';
import Button from '@/components/Button';

// Landing page preview of the Racing toolkit. Everything here is sample data;
// nothing is sent to the real analysis APIs.

const tools = [
  { name: 'Lap Compare', icon: GitCompareArrows, description: 'Two laps. Every corner. A clear path to a faster time.' },
  { name: 'Debrief Coach', icon: Sparkles, description: 'Turn your session into a focused plan for your next race.' },
  { name: 'Race Trends', icon: ChartNoAxesCombined, description: 'Your progress, from the first green flag to the latest finish.' },
  { name: 'Track Focus Areas', icon: MapPin, description: 'Make every corner a deliberate part of your practice.' },
  { name: 'Racecar Analysis', icon: Gauge, description: 'The right car for the track. Informed by the details.' },
  { name: 'Stint Analysis', icon: Flag, description: 'See where your pace holds up — and where it falls away.' },
];
const LAP_COMPARE = 0, DEBRIEF = 1, TRENDS = 2, FOCUS_AREAS = 3, RACECAR = 4, STINT = 5;

const tracks = ['Mobility Resort Motegi (Grand Prix)', 'Circuit Zandvoort', 'Spa-Francorchamps'];

const focusRows = [
  ['T 1 & 2', '0.02 – 0.09', '511 ft', '79%', '1,008 ft'],
  ['T 3 & 4', '0.16 – 0.25', '3,163 ft', '86%', '—'],
  ['T 5', '0.31 – 0.36', '5,019 ft', '84%', '5,463 ft'],
  ['T 7', '0.44 – 0.52', '7,190 ft', '68%', '7,621 ft'],
  ['T 9', '0.54 – 0.58', '8,711 ft', '76%', '9,034 ft'],
  ['T 10', '0.63 – 0.69', '10,129 ft', '86%', '10,488 ft'],
];

const comparisonRows = [
  ['T 1 & 2', '−0.016s', '58 ft earlier', '+2 mph'],
  ['T 5', '+0.123s', '29 ft earlier', '−2 mph'],
  ['T 9', '−0.061s', '4 ft earlier', '+0 mph'],
  ['T 10', '+0.023s', '139 ft earlier', '+0 mph'],
];

const sampleCars = [
  ['Porsche 911 GT3 R', 'Responsive front end, strong traction, precise rotation.'],
  ['Ferrari 296 GT3', 'Balanced handling and confidence through technical corners.'],
  ['BMW M4 GT3 EVO', 'Stable braking platform with predictable power delivery.'],
];

function TelemetryChart({ trend = false, stint = false }: { trend?: boolean; stint?: boolean }) {
  const pace = '35,60 60,59 79,62 95,126 112,150 133,123 149,78 172,55 192,60 207,96 223,144 239,130 255,58 283,48 300,69 315,156 333,138 351,99 370,52 399,50 412,93 430,157 450,141 471,72 497,48 516,56 530,110 549,132 570,58';
  const ratings = '35,150 59,158 82,148 106,165 133,150 150,126 174,134 191,108 212,117 237,91 253,121 272,98 292,105 313,72 333,84 354,70 379,89 399,67 420,60 442,76 463,43 483,56 501,35 521,48 546,40 570,51';
  const label = trend ? 'Sample iRating increases over six months' : stint ? 'Sample lap times across a racing stint' : 'Sample speed comparison of two laps across the track';
  const axis = trend ? ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'] : stint ? ['Lap 2', 'Lap 4', 'Lap 6', 'Lap 8', 'Lap 10'] : ['0 m', '1,000 m', '2,000 m', '3,000 m', '4,000 m'];

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

function Insight({ title = 'Carry more speed through T 10', tag = 'Priority focus', gain = '~0.10s / lap potential', children }: { title?: string; tag?: string; gain?: string; children: ReactNode }) {
  return (
    <div className="insight">
      <span className="insight-tag">{tag}</span>
      <h4>{title}</h4>
      <p>{children}</p>
      <span className="insight-gain">{gain}</span>
    </div>
  );
}

function TrackSelect({ value, onChange, label }: { value: string; onChange: (track: string) => void; label: string }) {
  return (
    <select className="track-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {tracks.map((t) => <option key={t}>{t}</option>)}
    </select>
  );
}

export default function CoachingWorkbench() {
  const [active, setActive] = useState(LAP_COMPARE);
  const [track, setTrack] = useState(tracks[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [question, setQuestion] = useState('Which GT3 car should I drive at Zandvoort?');
  const [answer, setAnswer] = useState(false);
  const [newArea, setNewArea] = useState('');
  const [areas, setAreas] = useState(focusRows);
  const input = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]) {
    const selected = Array.from(incoming);
    const valid = selected.filter((file) => file.name.toLowerCase().endsWith('.csv') && file.size <= 25 * 1024 * 1024);
    setFiles((prev) => [...prev, ...valid]);
    setMessage(valid.length !== selected.length
      ? 'Please choose CSV files smaller than 25 MB.'
      : `${valid.length} CSV ${valid.length === 1 ? 'file' : 'files'} added. Preview only — live analysis is not connected.`);
  }

  function footerAction() {
    if (active === LAP_COMPARE) setShowDetails(!showDetails);
    else if (active === DEBRIEF) { setReviewed(true); setMessage('Sample debrief displayed. Live CSV analysis is not connected.'); }
    else if (active === TRENDS) setMessage('Live iRacing sync is not connected to this website preview.');
    else if (active === STINT) setMessage('Sample stint: 6 clean laps, best lap 1:49.331, average variation ±0.42s.');
    else { setActive(LAP_COMPARE); setShowDetails(false); }
  }

  const footerLabel = active === LAP_COMPARE ? (showDetails ? 'Hide full comparison' : 'Explore lap comparison')
    : active === DEBRIEF ? 'Preview debrief'
    : active === TRENDS ? 'Sync iRacing'
    : active === STINT ? 'Review sample stint'
    : 'Explore lap comparison';

  const stats = active === TRENDS ? [['iRating', '1,991'], ['Safety rating', '3.42'], ['Avg. start', 'P8']]
    : active === STINT ? [['Best lap', '1:49.331'], ['Consistency', '±0.42s'], ['Clean laps', '6 / 8']]
    : [['Your lap', '1:50.056'], ['Reference lap', '1:49.410'], ['Time to find', '0.646s']];

  return (
    <>
      <div className="tool-tabs" role="tablist" aria-label="Coaching tools">
        {tools.map((tool, index) => (
          <Button
            key={tool.name}
            variant="ghost"
            role="tab"
            id={`tool-tab-${index}`}
            aria-controls="coaching-panel"
            aria-selected={active === index}
            onClick={() => { setActive(index); setMessage(''); setShowDetails(false); }}
          >
            <tool.icon size={15} />{tool.name}
          </Button>
        ))}
      </div>

      <div className="workbench" role="tabpanel" id="coaching-panel" aria-labelledby={`tool-tab-${active}`}>
        <div className="workspace-heading">
          <div>
            <h3>{tools[active].name}</h3>
            <p>{tools[active].description}</p>
          </div>
          <span className="demo-badge">Interactive preview</span>
        </div>

        {(active === LAP_COMPARE || active === TRENDS || active === STINT) && (
          <div className="workspace-grid">
            <div>
              <div className="chart-top">
                <TrackSelect label="Track" value={track} onChange={setTrack} />
                <div className="chart-legend">
                  <span><i className="legend-dot" />{active === TRENDS ? 'iRating' : active === STINT ? 'Lap time' : 'Your lap'}</span>
                  {active !== TRENDS && <span><i className="legend-dot reference" />Reference</span>}
                </div>
              </div>
              <TelemetryChart trend={active === TRENDS} stint={active === STINT} />
              <div className="lap-summary">
                {stats.map(([label, value], i) => (
                  <div key={label}>
                    <span className="stat-label">{label}</span>
                    <strong className={`stat-value ${i === 2 ? 'stat-positive' : ''}`}>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="insight-heading"><Sparkles />COACH&apos;S INSIGHT</div>
              {active === TRENDS ? (
                <>
                  <Insight title="Your pace is trending up" gain="+641 iRating in the sample period">
                    The sample season shows a steady climb from 1,350 to 1,991. Strong finishes and cleaner races are moving in the right direction.
                  </Insight>
                  <Insight tag="Next up" title="Consistency beats one fast lap" gain="Keep building clean finishes">
                    Compare safety rating and starting position alongside pace to see a more complete picture of your development.
                  </Insight>
                </>
              ) : (
                <>
                  <Insight title={active === STINT ? 'Keep your middle stint consistent' : undefined}>
                    {active === STINT
                      ? 'The middle of this sample stint shows the largest time variation. Focus on repeatable braking and a stable minimum corner speed.'
                      : 'You’re losing momentum at the apex. Aim for a minimum speed of 42.3 mph, and get back to the throttle with a smoother transition.'}
                  </Insight>
                  <Insight tag="Next up" title="Fine-tune your braking at T 9" gain="~0.09s / lap potential">
                    Brake a little later and release progressively. Your reference lap carries more speed into the corner without sacrificing the exit.
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
                <p>Drop your lap CSV files here</p>
                <small>CSV · Up to 25 MB per file · At least 2 laps</small>
                <Button variant="outline" onClick={() => input.current?.click()}>Browse files <ArrowRight /></Button>
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
                  <Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => setFiles((prev) => prev.filter((_, index) => index !== i))}><X /></Button>
                </div>
              ))}
              <p className="status-message" role="status">{message}</p>
            </div>
            <div>
              <div className="insight-heading"><Sparkles />{reviewed ? 'SAMPLE DEBRIEF' : 'DEBRIEF PREVIEW'}</div>
              <Insight>
                Sample session: the faster laps maintain 42.3 mph through T 10, compared with 39.8 mph on the slower laps. Carry more speed through the apex.
              </Insight>
              <p className="analysis-note">Sample coaching findings are shown here. Uploaded files are not sent for AI analysis in this website preview.</p>
            </div>
          </div>
        )}

        {active === FOCUS_AREAS && (
          <>
            <div className="chart-top">
              <TrackSelect label="Focus area track" value={track} onChange={setTrack} />
              <span className="stat-label">{areas.length} sample focus areas</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>{['Focus area', 'Start – End', 'Brake point', 'Max brake', 'On throttle', ''].map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {areas.map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => <td key={j}>{v}</td>)}
                      <td>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${row[0]}`} onClick={() => setAreas((prev) => prev.filter((_, idx) => idx !== i))}><X /></Button>
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
                if (newArea.trim()) { setAreas((prev) => [...prev, [newArea.trim(), '—', '—', '—', '—']]); setNewArea(''); }
              }}
            >
              <input className="text-input" value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="New focus area name" aria-label="New focus area name" required />
              <Button type="submit">Add focus area <MapPin /></Button>
            </form>
            <p className="analysis-note">Sample Motegi measurements. Track selections and edits are for this preview only.</p>
          </>
        )}

        {active === RACECAR && (
          <>
            <form className="question-form" onSubmit={(e) => { e.preventDefault(); if (question.trim()) setAnswer(true); }}>
              <input className="text-input" aria-label="Racecar question" value={question} onChange={(e) => { setQuestion(e.target.value); setAnswer(false); }} required />
              <Button type="submit"><Sparkles />Preview analysis</Button>
            </form>
            {answer ? (
              <>
                <p className="analysis-note">Illustrative Zandvoort comparison — not a live answer to your question. Actual recommendations require connected car and track data.</p>
                {sampleCars.map(([car, copy], i) => (
                  <div className="car-result" key={car}>
                    <div className="car-result-main">
                      <span className="rank">0{i + 1}</span>
                      <div><strong>{car}</strong><p>{copy}</p></div>
                    </div>
                    <Gauge className="text-muted-foreground" />
                  </div>
                ))}
              </>
            ) : (
              <div className="analysis-note">Preview a car comparison based on a technical circuit with high cornering demands.</div>
            )}
          </>
        )}

        {showDetails && active === LAP_COMPARE && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Focus area</th><th>Time difference</th><th>Braking</th><th>Minimum speed</th></tr></thead>
              <tbody>
                {comparisonRows.map((row) => <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel-footer">
          <p>Sample data. Real insights. A feel for what’s possible.</p>
          <Button size="sm" variant={showDetails ? 'outline' : 'default'} onClick={footerAction}>{footerLabel}<ArrowRight /></Button>
        </div>
        {message && active !== DEBRIEF && <p className="status-message" role="status">{message}</p>}
      </div>
    </>
  );
}
