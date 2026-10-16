'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/components/LanguageProvider';
import { fmt } from '@/lib/i18n/languages';
import type { TrackData } from '@/lib/tracks';
import { useUnits } from '@/components/UnitsProvider';
import { DISTANCE_UNIT, distanceFromFeet } from '@/lib/units';

const target = (value: number | null, unit: string, locale: string) => (value === null ? '—' : `${value.toLocaleString(locale)}${unit}`);

// Track Data's tracks and focus areas, the same for every user. Read only.
export default function TrackManagement() {
  const { t: dictionary, locale } = useLanguage();
  const units = useUnits();
  const t = dictionary.tracks;
  const unit = DISTANCE_UNIT[units];
  // Whole feet or meters for the track list
  const distance = (feet: number | null) => (feet === null ? null : Math.round(distanceFromFeet(feet, units)));
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/tracks')
      .then((response) => {
        if (response.status === 401) {
          setSignedOut(true);
          return { tracks: [] };
        }
        return response.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTracks(data.tracks ?? []);
      })
      .catch(() => setMessage(t.failedLoad))
      .finally(() => setLoaded(true));
  }, [t]);

  if (signedOut) {
    return (
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t.logIn}
        </Link>
        {t.signedOut}
      </div>
    );
  }

  return (
    <div className="bg-secondary rounded-xl border border-border p-8 space-y-6">
      {message && (
        <div className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{message}</div>
      )}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="overflow-x-auto bg-card border border-border rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary text-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t.track}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {fmt(t.lengthLabel, { unit })}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t.focusAreas}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t.notes}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-foreground">
              {tracks.map((track) => (
                <Fragment key={track.id}>
                  <tr>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === track.id ? null : track.id)}
                        aria-expanded={expanded === track.id}
                        className="text-left hover:text-primary"
                      >
                        <span className="inline-block w-4 text-muted-foreground">{expanded === track.id ? '▾' : '▸'}</span>
                        {track.name}
                      </button>
                      {track.key !== track.name && <p className="ml-4 text-xs font-normal text-muted-foreground">{track.key}</p>}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{target(distance(track.lengthFeet), '', locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {track.areas.length}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{track.notes ?? ''}</td>
                  </tr>

                  {/* Focus areas for this track */}
                  {expanded === track.id && (
                    <tr>
                      <td colSpan={4} className="px-4 pb-4 bg-secondary">
                        <table className="mt-3 w-full text-xs text-left bg-card border border-border rounded">
                          <thead className="bg-secondary text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">#</th>
                              <th className="px-3 py-2 font-medium">{t.name}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.startEnd}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.brakePoint}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.maxBrake}</th>
                              <th className="px-3 py-2 font-medium text-right">{t.onThrottle}</th>
                              <th className="px-3 py-2 font-medium">{t.notes}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {track.areas.map((a) => (
                              <tr key={a.id}>
                                <td className="px-3 py-1.5 text-muted-foreground">{a.position}</td>
                                <td className="px-3 py-1.5 font-semibold text-foreground">{a.name}</td>
                                <td className="px-3 py-1.5 text-right">
                                  {a.startPoint} – {a.endPoint}
                                </td>
                                <td className="px-3 py-1.5 text-right">{target(distance(a.brakePointFeet), ` ${unit}`, locale)}</td>
                                <td className="px-3 py-1.5 text-right">{target(a.maxBrakePct, '%', locale)}</td>
                                <td className="px-3 py-1.5 text-right">{target(distance(a.throttlePointFeet), ` ${unit}`, locale)}</td>
                                <td className="px-3 py-1.5 text-muted-foreground">{a.notes ?? ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
