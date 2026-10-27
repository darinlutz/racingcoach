import { aiModelProvider } from '@/lib/aiModelList';
import { DEFAULT_CALL_TOKENS, modelsByCost, type CallTokens } from '@/lib/aiModelPrices';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';

// The Admin page's AI Model Costs table: every model AI Model Control offers, one column each, cheapest on the left,
// with its price per million tokens and what 100 AI calls cost on it. A call's size is the site's own average over
// the last 30 days (readAverageCallTokens in src/lib/rateLimits.ts), or DEFAULT_CALL_TOKENS before there are enough.
export default function AiModelCostTable({
  t,
  locale,
  measured,
}: {
  t: Dictionary['admin'];
  locale: string;
  measured: (CallTokens & { calls: number }) | null;
}) {
  const tokens = measured ?? DEFAULT_CALL_TOKENS;
  const models = modelsByCost(tokens);
  const dollars = (value: number, digits: number) =>
    value.toLocaleString(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
  const number = (value: number) => Math.round(value).toLocaleString(locale);
  const sizes = { input: number(tokens.input), cached: number(tokens.cachedInput), output: number(tokens.output) };

  const rows = [
    { label: t.aiCostProvider, cell: (m: (typeof models)[number]) => aiModelProvider(m.model) },
    { label: t.aiCostInput, cell: (m: (typeof models)[number]) => dollars(m.price.input, 3) },
    { label: t.aiCostCachedInput, cell: (m: (typeof models)[number]) => dollars(m.price.cachedInput, 3) },
    { label: t.aiCostOutput, cell: (m: (typeof models)[number]) => dollars(m.price.output, 2) },
  ];

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-1">{t.aiCostTitle}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {measured ? fmt(t.aiCostIntroMeasured, { calls: number(measured.calls), ...sizes }) : fmt(t.aiCostIntroEstimate, sizes)}
      </p>

      <div className="overflow-x-auto">
        <table className="text-sm whitespace-nowrap">
          <thead>
            <tr className="text-xs font-medium text-muted-foreground">
              <th className="py-2 pr-4 text-left sticky left-0 bg-secondary">{t.aiModel}</th>
              {models.map(({ model }) => (
                <th key={model} className="py-2 px-3 text-right font-mono text-foreground">{model}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border text-muted-foreground">
                <th className="py-2 pr-4 text-left text-xs font-medium sticky left-0 bg-secondary">{row.label}</th>
                {models.map((m) => (
                  <td key={m.model} className="py-2 px-3 text-right tabular-nums">{row.cell(m)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-border">
              <th className="py-2 pr-4 text-left text-xs font-semibold text-foreground sticky left-0 bg-secondary">{t.aiCostPer100}</th>
              {models.map((m) => (
                <td key={m.model} className="py-2 px-3 text-right tabular-nums font-semibold text-foreground">{dollars(m.cost, 2)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t.aiCostNote}</p>
    </div>
  );
}
