'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { serviceColor } from '@/lib/aiLab/rules';
import { Notice, Panel, primaryClass, StatusDot, type LabOverview } from './aiLabUi';

// AI Lab's Open WebUI tab: Launch Open WebUI in its own tab, and why it isn't embedded (Open WebUI's X-Frame-Options
// DENY and Cloudflare Access's sign-in page can't be framed; the lab doesn't loosen either, or RacingCoach's CSP).

export default function AiLabOpenWebui({ data }: { data: LabOverview | null }) {
  const { t, fmt } = useLanguage();
  const l = t.aiLab;
  const w = l.openWebui;
  const gw = data?.lab.reachable ? data.lab.data : null;
  const color = gw ? serviceColor({ configured: gw.openWebui.configured, ok: gw.openWebui.ok, degraded: !gw.openWebui.apiKey }) : 'gray';
  const url = data?.settings.openWebuiUrl ?? null;

  return (
    <Panel title={w.title} intro={w.intro}>
      <div className="flex flex-wrap items-center gap-4">
        {url ? (
          <a className={primaryClass} href={url} target="_blank" rel="noopener noreferrer" data-track="ai-lab-launch-webui-tab">
            {w.launch}
          </a>
        ) : (
          <Notice tone="warn">{w.notSet}</Notice>
        )}
        <span className="text-sm text-muted-foreground">{w.reachable}:</span>
        <StatusDot color={color} label={l.status[color]} />
        {gw?.openWebui.version && <span className="text-sm text-muted-foreground">{fmt(l.overview.version, { version: gw.openWebui.version })}</span>}
      </div>
      {gw && !gw.openWebui.apiKey && <Notice tone="warn">{l.common.webuiNotConfigured}</Notice>}
      <Notice>{w.signIn}</Notice>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{w.whyNotEmbedded}</h3>
        <p className="text-sm text-muted-foreground">{w.whyNotEmbeddedText}</p>
      </div>
      <p className="text-xs text-muted-foreground">{w.license}</p>
    </Panel>
  );
}
