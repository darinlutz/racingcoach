'use client';

import { useSyncExternalStore } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

type LocalTimeProps = {
  iso: string;
  // date: October 30, 2026; dateTime: with the time; relative: 2 hours ago
  format: 'date' | 'dateTime' | 'relative';
  className?: string;
};

const noChanges = () => () => {};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

function formatted(iso: string, format: LocalTimeProps['format'], locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (format === 'date') return date.toLocaleDateString(locale, { dateStyle: 'long', timeZone });
  if (format === 'dateTime') return date.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short', timeZone });
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  const [unit, size] = UNITS.find(([, length]) => seconds >= length) ?? ['minute', 60];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.floor(seconds / size), unit);
}

// A time in the viewer's own time zone and language. The server doesn't know the time zone, so it sends UTC and the
// browser swaps it when it loads.
export default function LocalTime({ iso, format, className }: LocalTimeProps) {
  const { locale } = useLanguage();
  const text = useSyncExternalStore(
    noChanges,
    () => formatted(iso, format, locale),
    () => formatted(iso, format, locale, 'UTC')
  );
  return <time dateTime={iso} className={className}>{text}</time>;
}
