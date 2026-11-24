'use client';

import { useId } from 'react';

// The car paths box of the 3D Car Models (CarModelAssetManager.tsx) and Engineering Car Drawings (CarViewAssetManager.tsx): a comma separated list of iRacing car paths, typed or
// picked from the setup folders collectors have reported (setupFolders.ts). The suggestions are each folder after
// what's typed up to the last comma, so picking one adds it to the list, and folders already in it aren't offered
// again. A path not in the list can still be typed.
export default function CarPathCombobox({
  id,
  value,
  onChange,
  folders,
  className,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  folders: string[];
  className?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const comma = value.lastIndexOf(',');
  const prefix = comma < 0 ? '' : `${value.slice(0, comma + 1).replace(/\s*$/, '')} `;
  const chosen = new Set(
    value
      .slice(0, comma < 0 ? 0 : comma)
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
  );
  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={className}
      />
      <datalist id={listId}>
        {folders
          .filter((f) => !chosen.has(f))
          .map((f) => (
            <option key={f} value={`${prefix}${f}`} />
          ))}
      </datalist>
    </>
  );
}
