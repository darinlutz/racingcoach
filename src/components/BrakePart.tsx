'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { BrakeDrawingProps, SelectedBrake } from '@/lib/brakesGeometry';

// A part of a Brakes tab drawing that selects itself for the inspector when clicked or on Enter / Space, outlined while
// selected (globals.css's brake-part)
export default function BrakePart({ id, props, children }: { id: SelectedBrake; props: BrakeDrawingProps; children: ReactNode }) {
  const { t, fmt } = useLanguage();
  const b = t.setups.brakes;
  const name = id.length === 2 ? fmt(b.parts.caliper, { corner: b.corners[id as 'LF'] }) : b.parts[id as Exclude<SelectedBrake, 'LF' | 'RF' | 'LR' | 'RR'>];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={props.selected === id}
      aria-label={fmt(b.selectPart, { part: name })}
      className="brake-part"
      onClick={() => props.onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect(id);
        }
      }}
    >
      <title>{name}</title>
      {children}
    </g>
  );
}
