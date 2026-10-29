'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { isBackKey, isPlayPauseKey, keyDirection, nextFocus } from '@/lib/tvRemote';

// TV Broadcast Mode's remote control (src/lib/tvRemote.ts): the D-pad moves the focus between the controls marked
// data-tv-focus inside scope (the open panel's, when one is), Select presses the focused one (the browser sends
// Enter, which clicks it), Back calls onBack (which says whether it handled it; otherwise the browser goes back as
// usual), and Play/Pause calls onPlayPause.
export function useTvRemote(
  scope: RefObject<HTMLElement | null>,
  options: { onBack?: () => boolean; onPlayPause?: () => void } | null
): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const focusables = () =>
      [...(scope.current?.querySelectorAll<HTMLElement>('[data-tv-focus]') ?? [])].filter(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null
      );
    const onKey = (event: KeyboardEvent) => {
      if (isBackKey(event)) {
        if (latest.current?.onBack?.()) event.preventDefault();
        return;
      }
      if (isPlayPauseKey(event)) {
        latest.current?.onPlayPause?.();
        event.preventDefault();
        return;
      }
      const direction = keyDirection(event);
      if (!direction) return;
      // Typing in a field: the arrows move the caret
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === 'INPUT' && (direction === 'left' || direction === 'right')) return;
      event.preventDefault();
      const all = focusables();
      if (all.length === 0) return;
      const current = active && all.includes(active) ? active : null;
      if (!current) {
        all[0].focus();
        return;
      }
      const others = all.filter((el) => el !== current);
      const i = nextFocus(current.getBoundingClientRect(), others.map((el) => el.getBoundingClientRect()), direction);
      if (i >= 0) others[i].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scope]);
}
