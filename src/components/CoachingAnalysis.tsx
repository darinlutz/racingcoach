'use client';

import { useState } from 'react';
import FriendsRoster from '@/components/FriendsRoster';
import { useLanguage } from '@/components/LanguageProvider';
import StintAnalysis from '@/components/StintAnalysis';
import LapCompare from '@/components/LapCompare';
import DebriefCoach from '@/components/DebriefCoach';
import type { LapFile } from '@/lib/lapData';

// Friends and Stint Analysis tabs are hidden for now; set to true to show them again
const SHOW_FRIENDS_TAB = false;
const SHOW_STINT_TAB = false;

// Racecar Analysis is a tab of the Cars & Tracks page
type Tab = 'friends' | 'stint' | 'lapCompare' | 'debrief';

// Tab bar order: the top row on the left, the bottom row on the right
const TAB_ROWS: Tab[][] = [
  ['debrief', 'lapCompare', 'stint'],
  ['friends'],
];

// The My Sessions page's tabs (src/app/racing/page.tsx, which only shows them to signed-in users). lapSummary: the
// user may use Lap Compare's Provide summary (canUseLapSummary: not Bronze members)
export default function CoachingAnalysis({ lapSummary }: { lapSummary: boolean }) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('debrief');
  // Laps sent from Debrief Coach's Compare button, opened in Lap Compare (Target = the faster one)
  const [lapsToCompare, setLapsToCompare] = useState<{ base: LapFile; compare: LapFile } | null>(null);
  // Lap Compare presses Analyze Laps itself once for laps just sent, not again when its tab is reopened later
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const compareLaps = (base: LapFile, compare: LapFile) => {
    setLapsToCompare({ base, compare });
    setAutoAnalyze(true);
    setActiveTab('lapCompare');
  };

  const intro = activeTab === 'friends' || activeTab === 'stint' ? t.racing.intros[activeTab] : null;

  return (
    <div className="w-full">
      <section className="py-10 px-3 sm:px-4 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="w-full">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.racing.title}
          </h1>
        </div>
      </section>

      {/* The tabs take the full width, with a small margin, so Lap Compare's charts (two to a row) are as wide as they can be */}
      <section className="py-16 px-3 sm:px-4 bg-card">
        <div className="w-full">
          {/* Tab Navigation */}
          <div className="flex flex-col gap-4 mb-6 border-b border-border">
            {TAB_ROWS.map((row, i) => (
              <div key={i} className={`flex flex-wrap gap-4 ${i > 0 ? 'justify-end' : ''}`}>
                {row.filter((tab) => (tab !== 'friends' || SHOW_FRIENDS_TAB) && (tab !== 'stint' || SHOW_STINT_TAB)).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'text-primary border-primary'
                        : 'text-muted-foreground border-transparent hover:text-foreground'
                    }`}
                  >
                    {t.racing.tabs[tab]}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
            <h2 className={`text-2xl font-bold text-foreground ${intro ? 'mb-2' : 'mb-6'}`}>{t.racing.tabs[activeTab]}</h2>
            {intro && <p className="text-muted-foreground mb-6">{intro}</p>}

            {activeTab === 'friends' && <FriendsRoster />}
            {activeTab === 'stint' && <StintAnalysis />}
            {activeTab === 'lapCompare' && (
              <LapCompare
                initialLaps={lapsToCompare}
                lapSummary={lapSummary}
                autoAnalyze={autoAnalyze}
                onAutoAnalyzed={() => setAutoAnalyze(false)}
              />
            )}
            {activeTab === 'debrief' && <DebriefCoach onCompare={compareLaps} />}          </div>
        </div>
      </section>
    </div>
  );
}
