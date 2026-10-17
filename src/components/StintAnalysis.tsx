'use client';

import { useRef, useState } from 'react';

import { useLanguage } from '@/components/LanguageProvider';
import SectorChart from '@/components/SectorChart';
import { useUnits } from '@/components/UnitsProvider';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import StintConditions from '@/components/StintConditions';
import WeatherTable from '@/components/WeatherTable';
import { isStintExport, parseStintExport } from '@/lib/stintExport';
import { selectBestRun, stintReport, type StintSelection } from '@/lib/stintStats';
import { reportRateLimit } from '@/lib/rateLimitClient';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

const MAX_CSV_BYTES = 25 * 1024 * 1024;

// Asks the server for a coaching analysis of the stint report
async function fetchStintSummary(report: string, t: Dictionary) {
  try {
    const res = await fetch('/api/stint-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report }),
    });
    const data = await res.json();
    reportRateLimit(res, data);
    if (!res.ok) throw new Error(data.error || t.stint.failedAnalyze);
    return data.summary as string;
  } catch (err) {
    return fmt(t.lapCompare.summaryUnavailable, { error: err instanceof Error ? err.message : t.common.unknownError });
  }
}

export default function StintAnalysis() {
  const { t: dictionary, locale, plural } = useLanguage();
  const units = useUnits();
  const t = dictionary.stint;
  const [stint, setStint] = useState<StintSelection | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;
    if (fileList.length > 1) {
      setFileError(fmt(t.onlyOne, { n: fileList.length }));
      return;
    }

    const file = fileList[0];
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error(dictionary.laps.errors.notCsv);
      if (file.size > MAX_CSV_BYTES) throw new Error(dictionary.laps.errors.tooLarge);
      if (!(await isStintExport(file))) {
        throw new Error(t.notStint);
      }
      const selection = selectBestRun(await parseStintExport(file));
      if (!selection) throw new Error(t.noCleanLaps);
      setStint(selection);
      setFileError('');
      setAnalysis('');
    } catch (err) {
      setFileError(fmt(dictionary.laps.fileError, { name: file.name, error: (err as Error).message }));
    }
  };

  const analyzeStint = async () => {
    if (!stint) return;
    setAnalyzing(true);
    try {
      const report = stintReport(stint, dictionary.stintReport, locale, units);
      // Show the statistics right away, then add the coaching summary below them
      setAnalysis(`${report}\n\n${t.summaryWriting}`);
      setAnalysis(`${report}\n\n${t.summaryHeading}\n${await fetchStintSummary(report, dictionary)}`);
    } catch (err) {
      setAnalysis(fmt(t.errorAnalyzing, { error: err instanceof Error ? err.message : dictionary.common.unknownError }));
    } finally {
      setAnalyzing(false);
    }
  };

  const removeStint = () => {
    setStint(null);
    setAnalysis('');
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {stint ? (
        <WeatherTable
          stint={stint.stint}
          onRemove={removeStint}
          showWetness={false}
          summary={<StintConditions laps={stint.stint.laps} />}
          note={
            plural(stint.stint.laps.length, t.showing, { run: stint.run }) +
            (stint.runCount > 1 ? fmt(t.mostRuns, { runs: stint.runCount }) : '.')
          }
        />
      ) : (
        <div>
          <label className="block text-sm text-muted-foreground mb-2">{t.upload}</label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-colors ${
              dragging ? 'border-primary bg-accent' : 'border-border bg-card'
            }`}
          >
            <div className="text-sm text-muted-foreground text-center sm:text-left">
              <p className="font-medium text-foreground">{t.dragDrop}</p>
              <p>{t.limits}</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {dictionary.laps.browseFiles}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="text/csv,.csv"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}

      {fileError && (
        <div className="px-4 py-3 rounded-lg border text-sm whitespace-pre-wrap bg-primary/10 border-primary/40 text-red-300">
          {fileError}
        </div>
      )}

      <div className="space-y-4">
        {stint && <SectorChart laps={stint.stint.laps} sectorCount={stint.stint.sectorCount} />}

        <button
          type="button"
          onClick={() => void analyzeStint()}
          disabled={!stint || analyzing}
          className="px-6 py-3 font-semibold text-white bg-gradient-to-r from-primary to-primary-strong rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzing ? t.analyzing : t.analyze}
        </button>

        <div>
          <label htmlFor="stint-analysis" className="block text-sm font-medium text-foreground mb-2">
            {t.analysis}
          </label>
          <textarea
            id="stint-analysis"
            value={analysis}
            readOnly
            rows={16}
            placeholder={stint ? t.placeholder : t.placeholderNoStint}
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </div>
      </div>
    </div>
  );
}
