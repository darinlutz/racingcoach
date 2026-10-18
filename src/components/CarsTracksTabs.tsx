'use client';

import { useState } from 'react';
import CarDataManagement from '@/components/CarDataManagement';
import { useLanguage } from '@/components/LanguageProvider';
import SpaceFactQuery from '@/components/SpaceFactQuery';
import TrackManagement from '@/components/TrackManagement';
import { CARS_TRACKS_TABS, type CarsTracksTab } from '@/lib/carsTracksTabs';

// The Cars & Tracks page's tabs: Cars (Car Data), Tracks (Track Data) and Racecar Analysis
export default function CarsTracksTabs({ initialTab }: { initialTab: CarsTracksTab }) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<CarsTracksTab>(initialTab);

  const selectTab = (tab: CarsTracksTab) => {
    setActiveTab(tab);
    // Keep the tab in the URL, so reloading or sharing the page opens it
    window.history.replaceState(null, '', `?tab=${tab}`);
  };

  return (
    <>
      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-4 mb-6 border-b border-border">
        {CARS_TRACKS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => selectTab(tab)}
            className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
              activeTab === tab
                ? 'text-primary border-primary'
                : 'text-muted-foreground border-transparent hover:text-foreground'
            }`}
          >
            {t.carsTracks.tabs[tab]}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-secondary rounded-xl border border-border p-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">{t.carsTracks.tabs[activeTab]}</h2>
        <p className="text-muted-foreground mb-6">{t.carsTracks.intros[activeTab]}</p>

        {activeTab === 'cars' && <CarDataManagement />}
        {activeTab === 'tracks' && <TrackManagement />}
        {activeTab === 'racecar' && (
          <SpaceFactQuery
            endpoint="/api/racecar-analysis"
            queryLabel={t.carsTracks.racecarQuestionLabel}
            placeholder={t.carsTracks.racecarPlaceholder}
          />
        )}
      </div>
    </>
  );
}
