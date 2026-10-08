'use client';

// How many of the latest races the My Race Trends charts show; 0 means all of them
export const RACE_RANGES = [
  { value: 20, label: 'Last 20' },
  { value: 50, label: 'Last 50' },
  { value: 100, label: 'Last 100' },
  { value: 0, label: 'All' },
];

export const DEFAULT_RACE_RANGE = RACE_RANGES[0].value;

// The latest `range` items of a list sorted oldest first
export const lastRaces = <T,>(items: T[], range: number) => (range ? items.slice(-range) : items);

export default function RaceRangePicker({ value, onChange }: { value: number; onChange: (range: number) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Races shown">
      {RACE_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onChange(r.value)}
          aria-pressed={value === r.value}
          className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap transition-colors ${
            value === r.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
