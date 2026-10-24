'use client';

import { Fragment, useEffect, useState, type FocusEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/components/LanguageProvider';
import TrackSatellite, { SATELLITE_HEIGHT, SATELLITE_WIDTH } from '@/components/TrackSatellite';
import { fmt } from '@/lib/i18n/languages';
import { DEFAULT_TRACK_CATEGORY, trackCategoriesOf } from '@/lib/trackCategories';
import type { TrackData } from '@/lib/tracks';

// Track Data's tracks and focus areas, the same for every user. Read only. The Track Type radio buttons
// ("Tracks".track_category, Road Course by default) pick which tracks are listed.
export default function TrackManagement() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.tracks;
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [category, setCategory] = useState(DEFAULT_TRACK_CATEGORY);
  // The track whose name is hovered (or focused), and where its satellite picture goes. Fixed to the window, as
  // the table's scroll box would clip it; scrolling hides it
  const [picture, setPicture] = useState<{ track: TrackData; left: number; top: number } | null>(null);

  useEffect(() => {
    if (!picture) return;
    const hide = () => setPicture(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [picture]);

  // Under the name, or above it when there's no room below; kept inside the window
  const showPicture = (track: TrackData) => (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (!track.location && !track.bounds) return;
    const box = event.currentTarget.getBoundingClientRect();
    const below = box.bottom + 8 + SATELLITE_HEIGHT <= window.innerHeight;
    setPicture({
      track,
      left: Math.max(8, Math.min(box.left, window.innerWidth - SATELLITE_WIDTH - 8)),
      top: below ? box.bottom + 8 : Math.max(8, box.top - 8 - SATELLITE_HEIGHT),
    });
  };
  const hidePicture = () => setPicture(null);

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

  // Road Course always has a button, so the default has one even before tracks of that type have focus areas
  const categories = trackCategoriesOf(tracks);
  const categoryLabel = (value: string) => t.categories[value] ?? value;
  const shown = tracks.filter((track) => track.category === category);

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
        <>
          <fieldset>
            <legend className="block text-sm font-medium text-foreground mb-2">{t.trackType}</legend>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {categories.map((value) => (
                <label key={value} className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="radio"
                    name="trackType"
                    value={value}
                    checked={category === value}
                    onChange={() => {
                      setCategory(value);
                      setExpanded(null);
                    }}
                    data-track={`track-type-${value}`}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-semibold">{categoryLabel(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{fmt(t.noneOfType, { type: categoryLabel(category) })}</p>
          ) : (
            <div className="overflow-x-auto bg-card border border-border rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary text-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      {t.track}
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      {t.focusAreas}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-foreground">
                  {shown.map((track) => (
                    <Fragment key={track.id}>
                      <tr>
                        <th scope="row" className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === track.id ? null : track.id)}
                            onMouseEnter={showPicture(track)}
                            onMouseLeave={hidePicture}
                            onFocus={showPicture(track)}
                            onBlur={hidePicture}
                            aria-expanded={expanded === track.id}
                            className="text-left hover:text-primary"
                          >
                            <span className="inline-block w-4 text-muted-foreground">{expanded === track.id ? '▾' : '▸'}</span>
                            {track.name}
                          </button>
                          {track.key !== track.name && <span className="ml-3 text-xs font-normal text-muted-foreground">{track.key}</span>}
                        </th>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {track.areas.length}
                        </td>
                      </tr>

                      {/* Focus areas for this track */}
                      {expanded === track.id && (
                        <tr>
                          <td colSpan={2} className="px-4 pb-4 bg-secondary">
                            <table className="mt-3 w-full text-xs text-left bg-card border border-border rounded">
                              <thead className="bg-secondary text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2 font-medium">#</th>
                                  <th className="px-3 py-2 font-medium">{t.name}</th>
                                  <th className="px-3 py-2 font-medium text-right">{t.startEnd}</th>
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
        </>
      )}

      {picture && (
        <div className="fixed z-50 pointer-events-none" style={{ left: picture.left, top: picture.top }}>
          <TrackSatellite track={picture.track} />
        </div>
      )}
    </div>
  );
}
