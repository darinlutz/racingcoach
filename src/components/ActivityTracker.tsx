'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { redactUrl } from '@/lib/redactUrl';

// Records every page view and every click on a link, button or other control, and sends them in batches
// to /api/activity (racingcoach."ActivityLog", see src/lib/activityLog.ts). Rendered once by the root
// layout. Clicks on plain text or empty space aren't recorded, and neither is anything typed into a field:
// only which control was clicked and its visible label. Put data-no-track on an element to leave it and
// everything inside it out, and data-track="name" to give a control a stable name in the log.

type ActivityEvent = {
  type: 'page_view' | 'click';
  occurredAt: number;
  path: string;
  pageTitle?: string;
  referrer?: string;
  element?: string;
  elementId?: string;
  label?: string;
  targetHref?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

const ENDPOINT = '/api/activity';
// Matches MAX_ACTIVITY_EVENTS in src/lib/activityLog.ts
const MAX_BATCH = 50;
const FLUSH_AFTER_MS = 3000;
const FLUSH_AT_COUNT = 20;
const SESSION_KEY = 'activitySessionId';

const CLICKABLE = [
  'a[href]',
  'button',
  'summary',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="switch"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
].join(', ');

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // crypto.randomUUID needs HTTPS (or localhost); this is only for plain-HTTP previews
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// One ID per browser tab, kept across reloads of that tab
function tabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = randomId();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function currentPath(): string {
  return redactUrl(`${location.pathname}${location.search}${location.hash}`);
}

// Same-site links as a path, other sites as the full URL
function hrefOf(element: Element): string | undefined {
  if (!(element instanceof HTMLAnchorElement)) return undefined;
  try {
    const url = new URL(element.href, location.href);
    return redactUrl(url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString());
  } catch {
    return undefined;
  }
}

function squash(text: string | null | undefined): string | undefined {
  const squashed = text?.replace(/\s+/g, ' ').trim();
  return squashed ? squashed.slice(0, 200) : undefined;
}

// What the person saw on the control. Never the value of a text field.
function labelOf(element: Element): string | undefined {
  const aria = squash(element.getAttribute('aria-label')) ?? squash(element.getAttribute('title'));
  if (aria) return aria;
  if (element instanceof HTMLInputElement) {
    if (['submit', 'button', 'reset'].includes(element.type)) return squash(element.value);
    return squash(element.labels?.[0]?.textContent) ?? squash(element.name);
  }
  if (element instanceof HTMLSelectElement) {
    return squash(element.labels?.[0]?.textContent) ?? squash(element.name);
  }
  return squash((element as HTMLElement).innerText ?? element.textContent);
}

// "link", "button", "tab", "checkbox"…
function kindOf(element: Element): string {
  const role = element.getAttribute('role');
  if (role) return role;
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLInputElement) return element.type === 'submit' || element.type === 'reset' ? 'button' : element.type;
  return element.tagName.toLowerCase();
}

export default function ActivityTracker() {
  const pathname = usePathname();
  const queue = useRef<ActivityEvent[]>([]);
  const timer = useRef<number | null>(null);
  const sessionId = useRef<string | null>(null);
  const lastPath = useRef<string | null>(null);

  // Sends what's queued. While the page is closing, sendBeacon is used: the browser delivers it even after
  // the page is gone.
  const flush = useRef((closing = false) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    while (queue.current.length > 0) {
      const events = queue.current.splice(0, MAX_BATCH);
      sessionId.current ??= tabSessionId();
      const body = JSON.stringify({ sessionId: sessionId.current, language: document.documentElement.lang, events });
      if (closing && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {
          // Logging must never get in the way of using the site
        });
      }
    }
  });

  const record = useRef((event: Omit<ActivityEvent, 'occurredAt' | 'viewportWidth' | 'viewportHeight'>, occurredAt = Date.now()) => {
    queue.current.push({ ...event, occurredAt, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    if (queue.current.length >= FLUSH_AT_COUNT) {
      flush.current();
    } else if (timer.current === null) {
      timer.current = window.setTimeout(() => flush.current(), FLUSH_AFTER_MS);
    }
  });

  // A page view each time the page changes, including client-side navigation
  useEffect(() => {
    const occurredAt = Date.now();
    const path = currentPath();
    const referrer = lastPath.current ?? (document.referrer ? redactUrl(document.referrer) : undefined);
    lastPath.current = path;
    // Wait a moment so the new page's title is in place
    const wait = window.setTimeout(() => {
      record.current({ type: 'page_view', path, pageTitle: squash(document.title), referrer }, occurredAt);
    }, 300);
    return () => window.clearTimeout(wait);
  }, [pathname]);

  useEffect(() => {
    // Capture phase, so clicks are seen even when a handler stops them from bubbling
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const element = target?.closest(CLICKABLE);
      if (!element || element.closest('[data-no-track]')) return;
      record.current({
        type: 'click',
        path: currentPath(),
        pageTitle: squash(document.title),
        element: kindOf(element),
        elementId: squash(element.getAttribute('data-track')) ?? squash(element.id) ?? squash(element.getAttribute('name')),
        label: labelOf(element),
        targetHref: hrefOf(element),
      });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush.current(true);
    };
    const onPageHide = () => flush.current(true);

    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return null;
}
