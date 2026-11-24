'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { Notice, Panel } from './aiLabUi';

// AI Lab's Fine-Tuning Lab: the plan only (docs/AI_LAB_SETUP.md, Phase 4). Nothing here trains a model.

export default function AiLabFineTuning() {
  const { t } = useLanguage();
  const f = t.aiLab.fineTuning;
  return (
    <Panel title={f.title} intro={f.intro}>
      <Notice tone="warn">{f.status}</Notice>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">{f.stagesTitle}</h3>
        <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
          {f.stages.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
