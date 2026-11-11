'use client';

import { useLanguage } from '@/components/LanguageProvider';
import type { PlayerMetrics } from '@/components/LiveOBSPlayer';
import type { TimelineView } from '@/components/useBroadcastTimeline';
import type { BroadcastSourceKind } from '@/lib/liveVideo/broadcastSource';
import type { TvLiveVideo } from '@/lib/liveVideo/broadcastSourceRuntime';

// TV Broadcast Mode's live video figures, in its Settings panel (docs/live-video.md). Each says what it is: measured
// (the stream's own frame times), estimated (the player's guess at how far behind live it is) or calibrated (the
// Admin's offset); a figure there's nothing to measure from says not measured, rather than a number.

const seconds = (ms: number | null | undefined) => (ms == null ? null : `${(ms / 1000).toFixed(1)} s`);

export default function TvLiveVideoDiagnostics({
  liveVideo,
  camera,
  metrics,
  timeline,
}: {
  liveVideo: TvLiveVideo;
  camera: BroadcastSourceKind;
  metrics: PlayerMetrics | null;
  timeline: TimelineView;
}) {
  const { t } = useLanguage();
  const v = t.liveVideo;
  const d = v.tv.diagnosticsRows;
  const none = v.tv.notMeasured;
  const latency =
    metrics?.measuredLatencyMs != null
      ? `${seconds(metrics.measuredLatencyMs)} (${v.basis.measured})`
      : metrics?.latencyS != null
        ? `${metrics.latencyS.toFixed(1)} s (${v.basis.estimated})`
        : none;
  const rows: [string, string][] = [
    [d.source, `${v.tv.sources[camera]} · ${v.reasons[liveVideo.source.reason as keyof typeof v.reasons] ?? liveVideo.source.reason}`],
    [d.stream, liveVideo.stream ? `${liveVideo.stream.name} · ${v.status[metrics?.status ?? liveVideo.stream.status]}` : v.views.noStream],
    [d.latency, latency],
    [d.delay, timeline.appliedDelayMs > 0 ? `${seconds(timeline.appliedDelayMs)} (${v.basis[timeline.delay.basis]})` : v.basis.off],
    [d.error, timeline.syncErrorMs != null ? `${seconds(timeline.syncErrorMs)} (${v.basis.measured})` : none],
    [d.buffer, `${seconds(timeline.spanMs)}`],
    [d.samples, `${timeline.stats.late} / ${timeline.stats.outOfOrder} / ${timeline.stats.duplicates}`],
    [d.stalls, String(metrics?.stalls ?? 0)],
    [d.commentary, timeline.appliedDelayMs > 0 ? `${seconds(timeline.appliedDelayMs)}` : v.basis.off],
  ];
  return (
    <div className="mt-8">
      <p className="flex items-center gap-3 text-[22px] uppercase tracking-wide text-[#8b95a3]">
        {v.tv.diagnostics}
        {(timeline.delay.degraded || timeline.filling) && timeline.delay.basis !== 'off' && (
          <span className="rounded bg-[#ffd400] px-2 py-0.5 text-[16px] font-bold normal-case text-black">{v.tv.syncDegraded}</span>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[20px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[#8b95a3]">{label}</dt>
            <dd className="tabular-nums text-[#e6ebf2]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
