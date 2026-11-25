'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { ReferenceProvider } from './memoryUi';
import MmOverview from './MmOverview';
import MmLibrary from './MmLibrary';
import MmApprovals from './MmApprovals';
import MmConflicts from './MmConflicts';
import MmCategories from './MmCategories';
import MmNamespaces from './MmNamespaces';
import MmExtraction from './MmExtraction';
import MmRetrieval from './MmRetrieval';
import MmProviders from './MmProviders';
import MmInspector from './MmInspector';
import MmAnalytics from './MmAnalytics';
import MmEvaluation from './MmEvaluation';
import MmJobs from './MmJobs';
import MmImportExport from './MmImportExport';
import MmAudit from './MmAudit';
import MmSystem from './MmSystem';

// AI Lab's Memory Manager sub-tab (docs/AI_MEMORY_ARCHITECTURE.md): the console for the Clarivex Memory Service.
// Every section talks to the Memory API (/api/memory/v1) as the signed-in Admin; the server checks the role on
// every request. The section is kept in the address (#memoryManager:library) so a reload opens the same one.

export const SECTIONS = ['overview', 'library', 'approvals', 'conflicts', 'categories', 'namespaces', 'extraction', 'retrieval', 'providers', 'inspector', 'analytics', 'evaluation', 'jobs', 'importExport', 'audit', 'system'] as const;
export type MmSection = (typeof SECTIONS)[number];

const GROUPS: { key: 'memories' | 'review' | 'configure' | 'observe' | 'operate'; sections: MmSection[] }[] = [
  { key: 'memories', sections: ['overview', 'library'] },
  { key: 'review', sections: ['approvals', 'conflicts'] },
  { key: 'configure', sections: ['categories', 'namespaces', 'extraction', 'retrieval', 'providers', 'system'] },
  { key: 'observe', sections: ['inspector', 'analytics', 'evaluation', 'audit'] },
  { key: 'operate', sections: ['jobs', 'importExport'] },
];

export default function MemoryManager() {
  const { t } = useLanguage();
  const m = t.aiLab.memoryManager;
  const [section, setSection] = useState<MmSection>('overview');
  const [openMemory, setOpenMemory] = useState<string | null>(null);
  // A user's own space, opened from Namespaces (it isn't in the shared namespace pickers)
  const [libraryNamespace, setLibraryNamespace] = useState<{ id: string; path: string } | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const [tab, sub] = window.location.hash.replace(/^#/, '').split(':');
      if (tab === 'memoryManager' && (SECTIONS as readonly string[]).includes(sub)) setSection(sub as MmSection);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const go = (next: MmSection, memoryId?: string) => {
    setSection(next);
    if (memoryId) setOpenMemory(memoryId);
    window.history.replaceState(null, '', `#memoryManager:${next}`);
  };

  return (
    <ReferenceProvider>
      <div className="flex flex-col lg:flex-row gap-6">
        <nav aria-label={m.title} className="lg:w-56 shrink-0">
          <div className="lg:sticky lg:top-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">{m.title}</h2>
              <p className="text-xs text-muted-foreground">{m.intro}</p>
            </div>
            {GROUPS.map((g) => (
              <div key={g.key}>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">{m.groups[g.key]}</div>
                <ul className="flex lg:flex-col flex-wrap gap-1">
                  {g.sections.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        aria-current={section === s ? 'page' : undefined}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${section === s ? 'bg-primary/15 text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-card'}`}
                        onClick={() => go(s)}
                        data-track={`memory-${s}`}
                      >
                        {m.sections[s]}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="flex-1 min-w-0">
          {section === 'overview' && <MmOverview go={go} />}
          {section === 'library' && <MmLibrary openId={openMemory} onOpened={() => setOpenMemory(null)} preset={libraryNamespace} clearPreset={() => setLibraryNamespace(null)} />}
          {section === 'approvals' && <MmApprovals />}
          {section === 'conflicts' && <MmConflicts />}
          {section === 'categories' && <MmCategories />}
          {section === 'namespaces' && <MmNamespaces openLibrary={(n) => (setLibraryNamespace(n), go('library'))} />}
          {section === 'extraction' && <MmExtraction />}
          {section === 'retrieval' && <MmRetrieval />}
          {section === 'providers' && <MmProviders />}
          {section === 'inspector' && <MmInspector openMemory={(id) => go('library', id)} />}
          {section === 'analytics' && <MmAnalytics openMemory={(id) => go('library', id)} />}
          {section === 'evaluation' && <MmEvaluation />}
          {section === 'jobs' && <MmJobs />}
          {section === 'importExport' && <MmImportExport />}
          {section === 'audit' && <MmAudit />}
          {section === 'system' && <MmSystem />}
        </div>
      </div>
    </ReferenceProvider>
  );
}
