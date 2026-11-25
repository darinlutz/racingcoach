'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { btn, input, memApi, Notice, Toggle, useErrorText } from './memoryUi';

// The relationship graph: memories as nodes (their category's color, sized by importance, labelled), relationships
// as edges. A small force layout in plain SVG (no graph dependency or CDN), with pan (drag), zoom (wheel), type
// filters and click to open. Proposed (AI) relationships are dashed.

type Node = { id: string; title: string; category: string; color: string; namespace: string; status: string; importance: number };
type Edge = { id: string; fromId: string; toId: string; type: string; status: string };
type Pos = { x: number; y: number; vx: number; vy: number };

function layout(nodes: Node[], edges: Edge[], w: number, h: number): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    pos.set(n.id, { x: w / 2 + Math.cos(a) * w * 0.3, y: h / 2 + Math.sin(a) * h * 0.3, vx: 0, vy: 0 });
  });
  for (let step = 0; step < 300; step++) {
    const cool = 1 - step / 300;
    for (const a of nodes) {
      const pa = pos.get(a.id)!;
      for (const b of nodes) {
        if (a === b) continue;
        const pb = pos.get(b.id)!;
        const dx = pa.x - pb.x || 0.01;
        const dy = pa.y - pb.y || 0.01;
        const d2 = dx * dx + dy * dy;
        const f = 2500 / d2;
        pa.vx += (dx / Math.sqrt(d2)) * f;
        pa.vy += (dy / Math.sqrt(d2)) * f;
      }
      pa.vx += (w / 2 - pa.x) * 0.002;
      pa.vy += (h / 2 - pa.y) * 0.002;
    }
    for (const e of edges) {
      const a = pos.get(e.fromId);
      const b = pos.get(e.toId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 120) * 0.02;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    for (const p of pos.values()) {
      p.x += Math.max(-20, Math.min(20, p.vx)) * cool;
      p.y += Math.max(-20, Math.min(20, p.vy)) * cool;
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
  return pos;
}

export default function MmGraph({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useLanguage();
  const m = t.aiLab.memoryManager;
  const g = m.graph;
  const errorText = useErrorText();
  const [data, setData] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [all, setAll] = useState(false);
  const [type, setType] = useState('');
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const W = 900;
  const H = 560;

  useEffect(() => {
    memApi<{ nodes: Node[]; edges: Edge[] }>(`/relationships${all ? '?all=true' : ''}`).then(setData, setError);
  }, [all]);

  const edges = useMemo(() => (data?.edges ?? []).filter((e) => e.status !== 'rejected' && (!type || e.type === type)), [data, type]);
  const nodes = useMemo(() => data?.nodes ?? [], [data]);
  const pos = useMemo(() => layout(nodes, edges, W, H), [nodes, edges]);

  if (error) return <Notice tone="error">{errorText(error)}</Notice>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{g.intro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground mb-1">{g.filter}</span>
          <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{m.common.all}</option>
            {Object.entries(m.relationshipTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <Toggle checked={all} onChange={setAll} label={g.showAll} />
        <button type="button" className={btn} onClick={() => setView({ x: 0, y: 0, k: 1 })}>{g.reset}</button>
      </div>
      {!nodes.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{g.empty}</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto rounded-xl border border-border bg-card select-none touch-none"
          role="img"
          aria-label={m.library.view.graph}
          onWheel={(e) => {
            const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
            setView({ ...view, k });
          }}
          onPointerDown={(e) => (drag.current = { x: e.clientX - view.x, y: e.clientY - view.y })}
          onPointerMove={(e) => drag.current && setView({ ...view, x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          <defs>
            <marker id="mm-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} style={{ transformOrigin: `${W / 2}px ${H / 2}px` }}>
            {edges.map((e) => {
              const a = pos.get(e.fromId);
              const b = pos.get(e.toId);
              if (!a || !b) return null;
              const active = hover === e.fromId || hover === e.toId;
              return (
                <g key={e.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? 'stroke-foreground' : 'stroke-muted-foreground'} strokeOpacity={active ? 0.9 : 0.5} strokeWidth={active ? 2 : 1.5} strokeDasharray={e.status === 'proposed' ? '5 4' : undefined} markerEnd="url(#mm-arrow)" />
                  {active && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize={11} className="fill-foreground">
                      {(m.relationshipTypes as Record<string, string>)[e.type]}
                    </text>
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              const p = pos.get(n.id)!;
              const r = 6 + n.importance;
              return (
                <g key={n.id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => onOpen(n.id)}>
                  <circle r={r + 6} fill="transparent" />
                  <circle r={r} fill={n.color} className="stroke-card" strokeWidth={2} opacity={n.status === 'Active' ? 1 : 0.45} />
                  <text y={r + 13} textAnchor="middle" fontSize={11} className="fill-foreground">
                    {n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title}
                  </text>
                  <title>{`${n.title}\n${n.category} · ${n.namespace} · ${n.status}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
