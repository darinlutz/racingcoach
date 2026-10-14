'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { AI_FEATURE_VALUES, AI_FEATURES, AI_MODELS, type AiFeature, type AiModel } from '@/lib/aiModelList';

// The Admin page's AI Model Control section: pick a feature, pick its OpenAI model and save
// (PUT /api/admin/ai-models). The feature's next AI call uses it.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';

export default function AiModelManager({ models: initialModels }: { models: Record<AiFeature, AiModel> }) {
  const { t, fmt } = useLanguage();
  const a = t.admin;
  const [models, setModels] = useState(initialModels);
  const [feature, setFeature] = useState<AiFeature>(AI_FEATURE_VALUES[0]);
  const [model, setModel] = useState<AiModel>(initialModels[AI_FEATURE_VALUES[0]]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const featureName = (value: AiFeature) => a.aiFeatures[value] ?? value;
  const modelName = (value: AiModel) => (value === AI_FEATURES[feature] ? fmt(a.aiModelDefault, { model: value }) : value);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ai-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, model }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveSetting });
        return;
      }
      setModels((current) => ({ ...current, [feature]: model }));
      setMessage({ ok: true, text: fmt(a.aiModelSaved, { feature: featureName(feature), model }) });
    } catch {
      setMessage({ ok: false, text: t.api.failedSaveSetting });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-1">{a.aiModelsTitle}</h2>
      <p className="text-sm text-muted-foreground mb-4">{a.aiModelsIntro}</p>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="ai-feature" className={labelClass}>{a.aiFeature}</label>
          <select
            id="ai-feature"
            value={feature}
            onChange={(e) => {
              const next = e.target.value as AiFeature;
              setFeature(next);
              setModel(models[next]);
              setMessage(null);
            }}
            disabled={saving}
            className={`${inputClass} disabled:opacity-60`}
          >
            {AI_FEATURE_VALUES.map((value) => (
              <option key={value} value={value}>
                {featureName(value)} — {models[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ai-model" className={labelClass}>{a.aiModel}</label>
          <select
            id="ai-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value as AiModel);
              setMessage(null);
            }}
            disabled={saving}
            className={`${inputClass} disabled:opacity-60`}
          >
            {AI_MODELS.map((value) => (
              <option key={value} value={value}>
                {modelName(value)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || model === models[feature]}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? a.savingAiModel : a.saveAiModel}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`mt-3 p-3 rounded-lg text-sm ${
            message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
