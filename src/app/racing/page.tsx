'use client';

import { useState } from 'react';
import PythonRunner from '@/components/PythonRunner';
import FriendsRoster from '@/components/FriendsRoster';
import TrackFileExport from '@/components/TrackFileExport';
import TrackManagement from '@/components/TrackManagement';
import ChatbotLogger from '@/components/ChatbotLogger';
import SpaceFactQuery from '@/components/SpaceFactQuery';
import MultiLapAnalysis from '@/components/MultiLapAnalysis';
import StintAnalysis from '@/components/StintAnalysis';
import LapCompare from '@/components/LapCompare';
import DebriefCoach from '@/components/DebriefCoach';
import ReferencePoints from '@/components/ReferencePoints';
import RaceTrends from '@/components/RaceTrends';

// Space Fact Query tab is hidden for now; set to true to show it again
const SHOW_SPACE_FACTS_TAB = false;

export default function RacingPage() {
  const [activeTab, setActiveTab] = useState<'tracks' | 'friends' | 'chatbot' | 'spaceFacts' | 'racecar' | 'multiLap' | 'stint' | 'lapCompare' | 'debrief' | 'referencePoints' | 'raceTrends'>(
    'friends'
  );

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-100 to-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-powder-600 via-powder-500 to-powder-600 bg-clip-text text-transparent">
            Racing
          </h1>
          <p className="text-lg text-slate-600">
            Keep track of your friends and run the local Python app.
          </p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-white flex flex-col items-center">
        <div className="w-full max-w-4xl">
          {/* Tab Navigation */}
          <div className="flex flex-wrap gap-4 mb-6 border-b border-slate-200">
            <button
              onClick={() => setActiveTab('tracks')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'tracks'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Track Management
            </button>
            <button
              onClick={() => setActiveTab('friends')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'friends'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Friends
            </button>
            <button
              onClick={() => setActiveTab('chatbot')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'chatbot'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Chat Logger
            </button>
            {SHOW_SPACE_FACTS_TAB && (
              <button
                onClick={() => setActiveTab('spaceFacts')}
                className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                  activeTab === 'spaceFacts'
                    ? 'text-powder-600 border-powder-600'
                    : 'text-slate-600 border-transparent hover:text-dark-blue'
                }`}
              >
                Space Fact Query
              </button>
            )}
            <button
              onClick={() => setActiveTab('racecar')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'racecar'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Racecar Analysis
            </button>
            <button
              onClick={() => setActiveTab('multiLap')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'multiLap'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Multi-Lap Analysis
            </button>
            <button
              onClick={() => setActiveTab('stint')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'stint'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Stint Analysis
            </button>
            <button
              onClick={() => setActiveTab('lapCompare')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'lapCompare'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Lap Compare
            </button>
            <button
              onClick={() => setActiveTab('debrief')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'debrief'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Debrief Coach
            </button>
            <button
              onClick={() => setActiveTab('referencePoints')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'referencePoints'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Get Reference Points
            </button>
            <button
              onClick={() => setActiveTab('raceTrends')}
              className={`px-6 py-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'raceTrends'
                  ? 'text-powder-600 border-powder-600'
                  : 'text-slate-600 border-transparent hover:text-dark-blue'
              }`}
            >
              Race &amp; Qualy Trends
            </button>
          </div>

          {/* Tab Content */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-8">
            {/* Track Management Tab */}
            {activeTab === 'tracks' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Track Management</h2>
                <p className="text-slate-600 mb-6">
                  Your tracks and their focus areas (up to 8 per track). Expand a track to see its focus areas, or
                  press Edit to change them.
                </p>
                <TrackFileExport />
                <TrackManagement />
              </div>
            )}

            {/* Friends Tab */}
            {activeTab === 'friends' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Friends</h2>
                <p className="text-slate-600 mb-6">
                  Keep track of your friends. Each account has its own list.
                </p>
                <FriendsRoster />
              </div>
            )}

            {/* Chat Logger Tab */}
            {activeTab === 'chatbot' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Chat Logger</h2>
                <p className="text-slate-600 mb-6">
                  Chat with the logged chatbot and view its replies.
                </p>
                <ChatbotLogger />
                <div className="mt-6">
                  <PythonRunner />
                </div>
              </div>
            )}

            {/* Space Fact Query Tab */}
            {activeTab === 'spaceFacts' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Space Fact Query</h2>
                <p className="text-slate-600 mb-6">
                  Ask a question and get an answer grounded in a small set of space facts (RAG).
                </p>
                <SpaceFactQuery />
              </div>
            )}

            {/* Racecar Analysis Tab */}
            {activeTab === 'racecar' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Racecar Analysis</h2>
                <p className="text-slate-600 mb-6">
                  Ask a question and get an answer grounded in the racecar analysis data (RAG).
                </p>
                <SpaceFactQuery
                  endpoint="/api/racecar-analysis"
                  queryLabel="Ask a Question About Racecars"
                  placeholder="Enter your racecar question here"
                />
              </div>
            )}

            {/* Multi-Lap Analysis Tab */}
            {activeTab === 'multiLap' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Multi-Lap Analysis</h2>
                <p className="text-slate-600 mb-6">
                  Analyze multiple laps to find where you are most inconsistent.
                </p>
                <MultiLapAnalysis />
              </div>
            )}

            {/* Stint Analysis Tab */}
            {activeTab === 'stint' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Stint Analysis</h2>
                <p className="text-slate-600 mb-6">
                  Analyze a Garage 61 stint export: pace, sectors, weather and fuel.
                </p>
                <StintAnalysis />
              </div>
            )}

            {/* Lap Compare Tab */}
            {activeTab === 'lapCompare' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Lap Compare</h2>
                <p className="text-slate-600 mb-6">
                  Compare two laps focus area by focus area.
                </p>
                <LapCompare />
              </div>
            )}

            {/* Debrief Coach Tab */}
            {activeTab === 'debrief' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Debrief Coach</h2>
                <p className="text-slate-600 mb-6">
                  An AI coach reviews every lap of your session and tells you what to fix next time.
                </p>
                <DebriefCoach />
              </div>
            )}

            {/* Get Reference Points Tab */}
            {activeTab === 'referencePoints' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Get Reference Points</h2>
                <p className="text-slate-600 mb-6">
                  Upload your laps and get the brake point, max brake pressure and on-throttle point for each focus area.
                </p>
                <ReferencePoints />
              </div>
            )}

            {/* Race & Qualy Trends Tab */}
            {activeTab === 'raceTrends' && (
              <div>
                <h2 className="text-2xl font-bold text-dark-blue mb-2">Race &amp; Qualy Trends</h2>
                <p className="text-slate-600 mb-6">
                  Your races load automatically from iRacePlan. See how your iRating and incidents have moved over time.
                </p>
                <RaceTrends />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
