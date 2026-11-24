'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import AiLabConfigs from './AiLabConfigs';
import AiLabFineTuning from './AiLabFineTuning';
import AiLabKnowledge from './AiLabKnowledge';
import AiLabMemory from './AiLabMemory';
import AiLabModels from './AiLabModels';
import AiLabOpenWebui from './AiLabOpenWebui';
import AiLabOverview from './AiLabOverview';
import AiLabPlayground from './AiLabPlayground';
import { useLabOverview } from './aiLabUi';

// The AI Lab page's tabs (docs/AI_LAB_SETUP.md), for Admins. The tab is kept in the address's #hash, so a reload
// or a shared link opens the same one. Production Routing holds the Local AI sections that were already here
// (Server Mode, Inference Monitoring, Test Console), passed in from the page unchanged. One status poll is shared
// by every tab (useLabOverview).

const TABS = ['overview', 'openWebui', 'models', 'playground', 'memory', 'knowledge', 'configs', 'fineTuning', 'production', 'runPython'] as const;
type Tab = (typeof TABS)[number];

export default function AiLabWorkspace({ production, runPython }: { production: ReactNode; runPython: ReactNode }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('overview');
  const [testModel, setTestModel] = useState<string | null>(null);
  const overview = useLabOverview();

  useEffect(() => {
    const fromHash = () => {
      const value = window.location.hash.replace(/^#/, '') as Tab;
      if ((TABS as readonly string[]).includes(value)) setTab(value);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const go = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  return (
    <div className="site-container space-y-4">
      <div role="tablist" aria-label={t.modelLearning.title} className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => go(key)}
            data-track={`ai-lab-tab-${key}`}
          >
            {t.aiLab.tabs[key]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <AiLabOverview overview={overview} />}
      {tab === 'openWebui' && <AiLabOpenWebui data={overview.data} />}
      {tab === 'models' && (
        <AiLabModels
          data={overview.data}
          reload={overview.reload}
          onTest={(model) => {
            setTestModel(model);
            go('playground');
          }}
        />
      )}
      {tab === 'playground' && <AiLabPlayground data={overview.data} initialModel={testModel} />}
      {tab === 'memory' && <AiLabMemory data={overview.data} />}
      {tab === 'knowledge' && <AiLabKnowledge data={overview.data} />}
      {tab === 'configs' && <AiLabConfigs data={overview.data} />}
      {tab === 'fineTuning' && <AiLabFineTuning />}
      <div hidden={tab !== 'production'}>{production}</div>
      <div hidden={tab !== 'runPython'}>{runPython}</div>
    </div>
  );
}
