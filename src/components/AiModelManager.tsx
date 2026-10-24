'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import {
  AI_FEATURE_VALUES,
  AI_FEATURES,
  AI_MODEL_CATEGORIES,
  AI_MODEL_PROVIDERS,
  aiModelProvider,
  aiModelsFor,
  type AiFeature,
  type AiModel,
  type AiModelCategory,
} from '@/lib/aiModelList';

// The Admin page's AI Model Control section: a grid of every feature's OpenAI, Anthropic or DeepSeek model for each category
// of caller (Admin, Gold, Silver, Bronze; see aiModelCategoryOf in src/lib/aiModelList.ts). The In-Car AI Coach's
// features offer OpenAI and DeepSeek models only (aiModelsFor). Changed cells are saved together (PUT /api/admin/ai-models, one
// per cell); the feature's next AI call for that category uses them.

type Models = Record<AiModelCategory, Record<AiFeature, AiModel>>;

const selectClass =
  'w-full min-w-[9rem] px-2 py-1.5 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default function AiModelManager({ models: initialModels }: { models: Models }) {
  const { t, fmt } = useLanguage();
  const a = t.admin;
  const [saved, setSaved] = useState(initialModels);
  const [models, setModels] = useState(initialModels);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const featureName = (value: AiFeature) => a.aiFeatures[value] ?? value;
  const categoryName = (category: AiModelCategory) =>
    category === 'Admin' ? (a.roles.Admin ?? category) : (t.pricing.levelNames[category] ?? category);
  const modelName = (feature: AiFeature, value: AiModel) =>
    value === AI_FEATURES[feature] ? fmt(a.aiModelDefault, { model: value }) : value;

  const changes = AI_MODEL_CATEGORIES.flatMap((category) =>
    AI_FEATURE_VALUES.filter((feature) => models[category][feature] !== saved[category][feature]).map((feature) => ({
      category,
      feature,
      model: models[category][feature],
    }))
  );

  const change = (category: AiModelCategory, feature: AiFeature, model: AiModel) => {
    setModels((current) => ({ ...current, [category]: { ...current[category], [feature]: model } }));
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    let count = 0;
    try {
      for (const item of changes) {
        const res = await fetch('/api/admin/ai-models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ ok: false, text: data.error ?? t.api.failedSaveSetting });
          return;
        }
        setSaved((current) => ({ ...current, [item.category]: { ...current[item.category], [item.feature]: item.model } }));
        count++;
      }
      setMessage({ ok: true, text: fmt(a.aiModelSaved, { count }) });
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-muted-foreground">
              <th className="py-2 pr-3">{a.aiFeature}</th>
              {AI_MODEL_CATEGORIES.map((category) => (
                <th key={category} className="py-2 px-1">{categoryName(category)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AI_FEATURE_VALUES.map((feature) => (
              <tr key={feature} className="border-t border-border">
                <td className="py-2 pr-3 text-foreground">{featureName(feature)}</td>
                {AI_MODEL_CATEGORIES.map((category) => (
                  <td key={category} className="py-2 px-1">
                    <select
                      aria-label={`${featureName(feature)}: ${categoryName(category)}`}
                      value={models[category][feature]}
                      onChange={(e) => change(category, feature, e.target.value as AiModel)}
                      disabled={saving}
                      className={`${selectClass} disabled:opacity-60 ${
                        models[category][feature] !== saved[category][feature] ? 'border-primary' : ''
                      }`}
                    >
                      {AI_MODEL_PROVIDERS.map((provider) => {
                        const options = aiModelsFor(feature).filter((value) => aiModelProvider(value) === provider);
                        return options.length === 0 ? null : (
                          <optgroup key={provider} label={provider}>
                            {options.map((value) => (
                              <option key={value} value={value}>
                                {modelName(feature, value)}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || changes.length === 0}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? a.savingAiModel : a.saveAiModel}
        </button>
        {changes.length > 0 && !saving && (
          <span className="text-sm text-muted-foreground">{fmt(a.aiModelUnsaved, { count: changes.length })}</span>
        )}
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
