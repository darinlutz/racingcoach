'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';

// The Model Learning page's Run Model button and the box showing what src/day_1_tensors.py printed
// (POST /api/model-learning)
export default function ModelLearningRunner() {
  const { t } = useLanguage();
  const m = t.modelLearning;
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');

  const run = async () => {
    setRunning(true);
    setOutput('');
    try {
      const res = await fetch('/api/model-learning', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOutput(fmt(t.common.failed, { error: data.error ?? t.common.unknownError }));
        return;
      }
      setOutput([data.output, data.exitCode ? fmt(m.exitCode, { code: data.exitCode }) : null].filter(Boolean).join('\n\n') || m.noOutput);
    } catch {
      setOutput(fmt(t.common.failed, { error: t.common.unknownError }));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong disabled:opacity-60 transition-colors"
      >
        {running ? m.running : m.runModel}
      </button>
      <textarea
        readOnly
        value={output}
        placeholder={m.placeholder}
        aria-label={m.results}
        rows={20}
        className="w-full rounded-lg border border-border bg-background p-4 font-mono text-sm text-foreground"
      />
    </div>
  );
}
