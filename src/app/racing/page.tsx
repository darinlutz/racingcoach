'use client';

import { useState } from 'react';
import FriendsRoster from '@/components/FriendsRoster';
import { useLanguage } from '@/components/LanguageProvider';
import SpaceFactQuery from '@/components/SpaceFactQuery';
import StintAnalysis from '@/components/StintAnalysis';
import LapCompare from '@/components/LapCompare';
import DebriefCoach from '@/components/DebriefCoach';
import type { LapFile } from '@/lib/lapData';

// Space Fact Query, Friends and Stint Analysis tabs are hidden for now; set to true to show them again
const SHOW_SPACE_FACTS_TAB = false;
const SHOW_FRIENDS_TAB = false;
const SHOW_STINT_TAB = false;

// Racecar Analysis is a tab of the Cars & Tracks page
type Tab = 'friends' | 'spaceFacts' | 'stint' | 'lapCompare' | 'debrief';

// Tab bar order: the top row on the left, the bottom row on the right
const TAB_ROWS: Tab[][] = [
  ['debrief', 'spaceFacts', 'lapCompare', 'stint'],
  ['friends'],
];

export default function RacingPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('debrief');
  // Laps sent from Debrief Coach's Compare button, opened in Lap Compare (Base = the faster one)
  const [lapsToCompare, setLapsToCompare] = useState<{ base: LapFile; compare: LapFile } | null>(null);
  const compareLaps = (base: LapFile, compare: LapFile) => {
    setLapsToCompare({ base, compare });
    setActiveTab('lapCompare');
  };

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.racing.title}
          </h1>
          <p className="text-lg text-muted-foreground">{t.racing.intro}</p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl">
          {/* Tab Navigation */}
          <div className="flex flex-col gap-4 mb-6 border-b border-border">
            {TAB_ROWS.map((row, i) => (
              <div key={i} className={`flex flex-wrap gap-4 ${i > 0 ? 'justify-end' : ''}`}>
                {row.filter((tab) => (tab !== 'spaceFacts' || SHOW_SPACE_FACTS_TAB) && (tab !== 'friends' || SHOW_FRIENDS_TAB) && (tab !== 'stint' || SHOW_STINT_TAB)).map((tab) => (
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
          <div className="bg-secondary rounded-xl border border-border p-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">{t.racing.tabs[activeTab]}</h2>
            <p className="text-muted-foreground mb-6">{t.racing.intros[activeTab]}</p>

            {activeTab === 'friends' && <FriendsRoster />}
            {activeTab === 'spaceFacts' && <SpaceFactQuery />}
            {activeTab === 'stint' && <StintAnalysis />}
            {activeTab === 'lapCompare' && <LapCompare initialLaps={lapsToCompare} />}
            {activeTab === 'debrief' && <DebriefCoach onCompare={compareLaps} />}          </div>
        </div>
      </section>
    </div>
  );
}
