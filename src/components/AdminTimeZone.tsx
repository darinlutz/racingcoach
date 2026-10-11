'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

// The server can't know the admin's time zone, so on the first visit to the Admin page (no ?tz=) this
// adds the browser's to the URL; the page then shows dates and times in it, and the filter form keeps it.
export default function AdminTimeZone({ current }: { current: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (current) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    const params = new URLSearchParams(window.location.search);
    params.set('tz', zone);
    router.replace(`${pathname}?${params.toString()}`);
  }, [current, pathname, router]);

  return null;
}
