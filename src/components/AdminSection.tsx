'use client';

import { ChevronDown } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// The Admin page's collapsible sections (src/app/admin/page.tsx), closed until opened: by its bar, by its link in the
// nav at the top (AdminNav.tsx, which also scrolls to it), by the address's #hash (e.g. #monitoring and
// #collector-logs, which the error, spend and collector log emails link to) or by `initiallyOpen` (a filtered Activity
// Log or Collector Logs view, so submitting its filters doesn't close it). A section's contents mount the first time it
// opens and then stay mounted while it's closed, so a closed section doesn't load anything and closing one loses
// nothing typed in it.

export type AdminSectionKey = keyof Dictionary['admin']['nav']['sections'];

// Older links to parts of the page, and the section each is in
const HASH_ALIASES: Record<string, AdminSectionKey> = { monitoring: 'monitoring', 'collector-logs': 'collectorLogs' };

export const adminSectionId = (key: AdminSectionKey) => `admin-${key}`;

type Sections = {
  open: Set<AdminSectionKey>;
  toggle: (key: AdminSectionKey) => void;
  show: (key: AdminSectionKey) => void;
  setAll: (open: boolean) => void;
};

const SectionsContext = createContext<Sections | null>(null);

export function useAdminSections(): Sections {
  const sections = useContext(SectionsContext);
  if (!sections) throw new Error('useAdminSections needs AdminSectionsProvider');
  return sections;
}

function scrollTo(key: AdminSectionKey) {
  // After the section has rendered open
  requestAnimationFrame(() => document.getElementById(adminSectionId(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

export function AdminSectionsProvider({
  keys,
  initiallyOpen,
  children,
}: {
  keys: AdminSectionKey[];
  initiallyOpen: AdminSectionKey[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState<Set<AdminSectionKey>>(() => new Set(initiallyOpen));
  const toggle = useCallback(
    (key: AdminSectionKey) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    []
  );
  const show = useCallback((key: AdminSectionKey) => {
    setOpen((current) => (current.has(key) ? current : new Set(current).add(key)));
    scrollTo(key);
  }, []);
  const setAll = useCallback((all: boolean) => setOpen(all ? new Set(keys) : new Set()), [keys]);

  // A #hash in the address opens its section (on load, and when it changes)
  useEffect(() => {
    const fromHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const key = HASH_ALIASES[hash] ?? keys.find((k) => adminSectionId(k) === hash);
      if (key) show(key);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [keys, show]);

  const value = useMemo(() => ({ open, toggle, show, setAll }), [open, toggle, show, setAll]);
  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>;
}

export default function AdminSection({ section, children }: { section: AdminSectionKey; children: ReactNode }) {
  const { t } = useLanguage();
  const nav = t.admin.nav;
  const { open, toggle } = useAdminSections();
  const isOpen = open.has(section);
  // Mounted from the first time it opens
  const [mounted, setMounted] = useState(isOpen);
  if (isOpen && !mounted) setMounted(true);
  const bodyId = `${adminSectionId(section)}-body`;

  return (
    <div id={adminSectionId(section)} className="scroll-mt-24">
      <button
        type="button"
        onClick={() => toggle(section)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        title={isOpen ? nav.collapse : nav.expand}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-secondary px-4 py-3 text-left transition-colors hover:border-primary ${
          isOpen ? 'rounded-b-none border-b-0' : ''
        }`}
      >
        <span className="text-base font-semibold text-foreground">{nav.sections[section]}</span>
        <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {/* admin-section-body hides each container's own title (its text-xl h2, globals.css): the bar above names it */}
      <div id={bodyId} hidden={!isOpen} className="admin-section-body rounded-b-xl border border-t-0 border-border p-2 sm:p-3">
        {mounted && children}
      </div>
    </div>
  );
}
