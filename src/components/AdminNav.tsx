'use client';

import { useLanguage } from '@/components/LanguageProvider';
import { adminSectionId, useAdminSections, type AdminSectionKey } from '@/components/AdminSection';

// The links at the top of the Admin page: each opens its section (AdminSection.tsx) and scrolls to it; Expand all and
// Collapse all open or close every section
export default function AdminNav({ sections }: { sections: AdminSectionKey[] }) {
  const { t } = useLanguage();
  const nav = t.admin.nav;
  const { open, show, setAll } = useAdminSections();
  const chip = 'rounded-full border px-3 py-1 text-xs font-medium transition-colors';

  return (
    <nav aria-label={nav.jumpTo} className="rounded-xl border border-border bg-secondary p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{nav.jumpTo}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAll(true)} className={`${chip} border-border text-muted-foreground hover:text-foreground`}>
            {nav.expandAll}
          </button>
          <button type="button" onClick={() => setAll(false)} className={`${chip} border-border text-muted-foreground hover:text-foreground`}>
            {nav.collapseAll}
          </button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-2">
        {sections.map((key) => (
          <li key={key}>
            <a
              href={`#${adminSectionId(key)}`}
              onClick={(e) => {
                e.preventDefault();
                history.replaceState(null, '', `#${adminSectionId(key)}`);
                show(key);
              }}
              className={`${chip} inline-block ${
                open.has(key) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-foreground hover:border-primary hover:text-primary'
              }`}
            >
              {nav.sections[key]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
