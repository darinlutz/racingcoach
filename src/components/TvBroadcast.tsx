'use client';

import { Maximize, Minimize, Mic, Minus, Play, Plus, Settings, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import TvEventFeed from '@/components/TvEventFeed';
import TvLeaderboard from '@/components/TvLeaderboard';
import { useTvCommentary } from '@/components/useTvCommentary';
import { useTvFeed, type FeedStatus } from '@/components/useTvFeed';
import { useTvRemote } from '@/components/useTvRemote';
import { formatLapTime } from '@/lib/liveRacingFormat';
import type { FlagKind } from '@/lib/raceFlags';
import { toneWav } from '@/lib/tvAudio';

// TV Broadcast Mode's broadcast (src/app/tv/): the race the paired account may watch, as a TV graphics package on a
// 1920×1080 stage. Across the top the session, its flag, lap and time left; on the left the leaderboard; on the right
// the followed driver (the account's own driving, else the first live driver; Next driver changes it), the Race
// Announcer speaking with their line, and the race events. Along the bottom the controls, worked with the remote's
// D-pad and Select: Start Broadcast (the TV's browser only plays sound after a button press, so commentary waits for
// it), Test sound, commentary and each announcer on or off, volume, mute, next driver, full screen where the browser
// allows it, and Settings (screen edges, unpair), which the remote's Back closes. The choices are kept in the
// browser. While the broadcast runs the screen is kept awake (Wake Lock) where the browser allows it.

const KEYS = {
  commentary: 'tv.commentary',
  lead: 'tv.leadAnnouncer',
  color: 'tv.colorAnnouncer',
  volume: 'tv.volume',
  muted: 'tv.muted',
} as const;
const DEFAULT_VOLUME = 80;
const VOLUME_STEP = 10;

const FLAG_COLORS: Partial<Record<FlagKind, { bg: string; fg: string }>> = {
  green: { bg: '#00b140', fg: '#000' },
  yellow: { bg: '#ffd400', fg: '#000' },
  caution: { bg: '#ffd400', fg: '#000' },
  debris: { bg: '#ffd400', fg: '#000' },
  red: { bg: '#e10600', fg: '#fff' },
  white: { bg: '#ffffff', fg: '#000' },
  checkered: { bg: '#ffffff', fg: '#000' },
};

const ANNOUNCER_COLORS = { lead: '#e10600', color: '#2f7bff' } as const;

function clock(seconds: number | null): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // kept for this visit only
  }
}

type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

// A control's look without its background, and with the usual one
const controlClass =
  'flex h-[68px] items-center justify-center gap-3 rounded-xl px-6 text-[24px] font-semibold text-white outline-none ' +
  'focus:ring-[6px] focus:ring-[#ffd400] disabled:opacity-40';
const buttonClass = `${controlClass} bg-[#1b222d]`;

function StatusPill({ status, t }: { status: FeedStatus; t: ReturnType<typeof useLanguage>['t']['tv'] }) {
  const live = status === 'live' || status === 'fallback';
  return (
    <span
      className={`rounded-lg px-4 py-1 text-[26px] font-bold tracking-wide ${live ? 'bg-[#e10600] text-white' : 'bg-[#3a4350] text-[#e6ebf2]'}`}
    >
      {status === 'live' ? t.live : status === 'fallback' ? t.fallback : status === 'connecting' ? t.connecting : t.reconnecting}
    </span>
  );
}

export default function TvBroadcast({
  userName,
  announcers,
  edges,
  onEdges,
}: {
  userName: string;
  announcers: boolean;
  edges: number;
  onEdges: (edges: number) => void;
}) {
  const { t, fmt } = useLanguage();
  const [driver, setDriver] = useState<number | null>(null);
  const unpaired = useCallback(() => window.location.reload(), []);
  const { state, status } = useTvFeed(driver, unpaired);
  const focus = state?.focus ?? null;

  const [started, setStarted] = useState(false);
  const [audioError, setAudioError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [commentaryOn, setCommentaryOn] = useState(true);
  const [lead, setLead] = useState(true);
  const [color, setColor] = useState(true);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [fullScreenSupported, setFullScreenSupported] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const testButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read once from browser storage after hydration */
    setCommentaryOn(readStored(KEYS.commentary) !== '0');
    setLead(readStored(KEYS.lead) !== '0');
    setColor(readStored(KEYS.color) !== '0');
    const savedVolume = Number(readStored(KEYS.volume) ?? NaN);
    if (Number.isFinite(savedVolume)) setVolume(Math.min(Math.max(Math.round(savedVolume), 0), 100));
    setMuted(readStored(KEYS.muted) === '1');
    const doc = document as FullscreenDocument;
    setFullScreenSupported(!!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    /* eslint-enable react-hooks/set-state-in-effect */
    const onFullScreen = () => setFullScreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onFullScreen);
    document.addEventListener('webkitfullscreenchange', onFullScreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreen);
      document.removeEventListener('webkitfullscreenchange', onFullScreen);
    };
  }, []);

  const { speaking, problem, paused } = useTvCommentary(
    focus,
    { started, enabled: announcers && commentaryOn, lead, color, volume, muted },
    audioRef
  );

  const keepAwake = useCallback(async () => {
    try {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        wakeLock.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      // not allowed here: the TV's own screensaver settings apply
    }
  }, []);
  useEffect(() => {
    if (!started) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') keepAwake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wakeLock.current?.release().catch(() => undefined);
    };
  }, [started, keepAwake]);

  // Plays a WAV made here on the audio element; Start Broadcast's press is what lets the TV's browser play sound
  const playTone = (wav: Uint8Array): Promise<void> => {
    const audio = (audioRef.current ??= new Audio());
    const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }));
    audio.src = url;
    audio.volume = volume / 100;
    audio.muted = muted;
    return audio.play().finally(() => window.setTimeout(() => URL.revokeObjectURL(url), 2000));
  };

  const startBroadcast = () => {
    playTone(toneWav(440, 150, 0))
      .then(() => {
        setStarted(true);
        setAudioError('');
        keepAwake();
      })
      .catch(() => setAudioError(t.tv.audioBlocked));
  };

  const testSound = () => {
    if (speaking) return;
    playTone(toneWav(660, 450, 0.4)).catch(() => setAudioError(t.tv.audioBlocked));
  };

  const toggle = (key: string, value: boolean, set: (v: boolean) => void) => {
    set(value);
    store(key, value ? '1' : '0');
  };
  const changeVolume = (delta: number) => {
    const next = Math.min(Math.max(volume + delta, 0), 100);
    setVolume(next);
    store(KEYS.volume, String(next));
    if (muted && delta > 0) toggle(KEYS.muted, false, setMuted);
  };

  const toggleFullScreen = () => {
    const doc = document as FullscreenDocument;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc))?.();
      return;
    }
    const root = document.documentElement as FullscreenElement;
    if (root.requestFullscreen) root.requestFullscreen().catch(() => undefined);
    else root.webkitRequestFullscreen?.();
  };

  const nextDriver = () => {
    const list = state?.drivers ?? [];
    if (list.length < 2 || !focus) return;
    const at = list.findIndex((d) => d.id === focus.driverId);
    setDriver(list[(at + 1) % list.length].id);
  };

  // Settings opens as a history entry, so the remote's Back (which the browser may handle itself) closes it
  const openPanel = () => {
    window.history.pushState({ tvPanel: true }, '');
    setPanelOpen(true);
  };
  const closePanel = () => {
    if (panelOpen) window.history.back();
  };
  useEffect(() => {
    const onPop = () => setPanelOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // The panel's first control when it opens, Settings again when it closes, and Test sound (in Start Broadcast's
  // place) once started
  const wasOpen = useRef(false);
  useEffect(() => {
    if (panelOpen) panelRef.current?.querySelector<HTMLElement>('[data-tv-focus]')?.focus();
    else if (wasOpen.current) settingsButton.current?.focus();
    wasOpen.current = panelOpen;
  }, [panelOpen]);
  useEffect(() => {
    if (started) testButton.current?.focus();
  }, [started]);

  useTvRemote(panelOpen ? panelRef : mainRef, {
    onBack: () => {
      if (!panelOpen) return false;
      window.history.back();
      return true;
    },
    onPlayPause: () => (started ? toggle(KEYS.muted, !muted, setMuted) : startBroadcast()),
  });

  const unpair = async () => {
    await fetch('/api/tv/session', { method: 'DELETE' }).catch(() => undefined);
    window.location.replace('/tv');
  };

  const session = focus ? [focus.sessionType, focus.sessionName && focus.sessionName !== focus.sessionType ? focus.sessionName : null].filter(Boolean).join(' · ') : '';
  const flagColors = focus?.flag ? FLAG_COLORS[focus.flag] : undefined;
  const commentaryLine = !announcers
    ? t.tv.aiDisabled
    : !commentaryOn || (!lead && !color)
      ? t.tv.commentaryOff
      : problem || (paused ? t.tv.commentaryPaused : started ? t.tv.commentaryWaiting : t.tv.startHint);

  return (
    <div className="relative h-full">
      <div ref={mainRef} className="flex h-full flex-col gap-5" aria-hidden={panelOpen}>
        {/* Session header */}
        <header className="flex h-[100px] shrink-0 items-center gap-6 rounded-2xl bg-[#10141b] px-8">
          <StatusPill status={status} t={t.tv} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[44px] font-bold leading-none">{focus?.track ?? t.tv.title}</p>
            {session && <p className="mt-1 truncate text-[24px] uppercase tracking-wide text-[#a7b0bd]">{session}</p>}
          </div>
          {focus?.flag && flagColors && (
            <span className="rounded-lg px-5 py-2 text-[28px] font-bold uppercase" style={{ backgroundColor: flagColors.bg, color: flagColors.fg }}>
              {fmt(t.tv.eventFlag, { flag: t.tv.flags[focus.flag] })}
            </span>
          )}
          {focus && (
            <div className="text-right">
              <p className="text-[20px] uppercase tracking-wide text-[#8b95a3]">{t.tv.lap}</p>
              <p className="font-display text-[44px] font-bold leading-none tabular-nums">
                {focus.lap == null ? '—' : focus.lapsTotal ? fmt(t.tv.lapOf, { n: focus.lap, total: focus.lapsTotal }) : focus.lap}
              </p>
            </div>
          )}
          {focus && focus.timeRemain != null && (
            <div className="text-right">
              <p className="text-[20px] uppercase tracking-wide text-[#8b95a3]">{t.tv.timeRemaining}</p>
              <p className="font-display text-[44px] font-bold leading-none tabular-nums">{clock(focus.timeRemain)}</p>
            </div>
          )}
        </header>

        {/* Leaderboard and the followed driver */}
        <div className="flex min-h-0 flex-1 gap-5">
          <section className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-[#0a0d12] py-2">
            {!state ? (
              <p className="p-8 text-[32px] text-[#a7b0bd]">{t.tv.connecting}</p>
            ) : !focus ? (
              <div className="p-10">
                <p className="font-display text-[48px] font-bold">{t.tv.nobodyLive}</p>
                <p className="mt-4 max-w-[900px] text-[28px] leading-snug text-[#a7b0bd]">{t.tv.nobodyLiveHint}</p>
              </div>
            ) : focus.rows ? (
              <TvLeaderboard rows={focus.rows} multiClass={focus.multiClass} isRace={focus.isRace} />
            ) : (
              <p className="p-8 text-[28px] text-[#a7b0bd]">{t.tv.noField}</p>
            )}
          </section>

          <aside className="flex w-[600px] shrink-0 flex-col gap-5">
            <div className="rounded-2xl bg-[#10141b] p-6">
              {focus ? (
                <>
                  <p className="text-[20px] uppercase tracking-wide text-[#8b95a3]">{t.tv.following}</p>
                  <p className="truncate font-display text-[48px] font-bold leading-tight">{focus.driver}</p>
                  <p className="truncate text-[24px] text-[#a7b0bd]">{focus.car}</p>
                  {focus.offline ? (
                    <p className="mt-4 text-[26px] text-[#ffd400]">{fmt(t.tv.driverOffline, { name: focus.driver })}</p>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[24px]">
                      <div>
                        <p className="text-[18px] uppercase text-[#8b95a3]">{t.tv.position}</p>
                        <p className="font-display text-[48px] font-bold leading-none">
                          {focus.position == null ? '—' : focus.carsInSession ? fmt(t.tv.positionOf, { n: focus.position, total: focus.carsInSession }) : `P${focus.position}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-[18px] uppercase text-[#8b95a3]">{t.tv.incidents}</p>
                        <p className="font-display text-[48px] font-bold leading-none">
                          {focus.incidents == null ? '—' : fmt(t.tv.incidentsValue, { n: focus.incidents })}
                        </p>
                      </div>
                      <div>
                        <p className="text-[18px] uppercase text-[#8b95a3]">{t.tv.lastLap}</p>
                        <p className="tabular-nums text-[32px] font-semibold">{formatLapTime(focus.lastLapTime)}</p>
                      </div>
                      <div>
                        <p className="text-[18px] uppercase text-[#8b95a3]">{t.tv.bestLap}</p>
                        <p className="tabular-nums text-[32px] font-semibold">{formatLapTime(focus.bestLapTime)}</p>
                      </div>
                      {(focus.onPitRoad || !focus.onTrack) && (
                        <p className="col-span-2 text-[24px] font-semibold text-[#ffd400]">{focus.onPitRoad ? t.tv.pitRoad : t.tv.inGarage}</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[26px] text-[#a7b0bd]">{fmt(t.tv.pairedTo, { name: userName })}</p>
              )}
            </div>

            {/* The announcer speaking, as a lower third */}
            <div
              className="min-h-[150px] rounded-2xl border-l-[10px] bg-[#10141b] p-5"
              style={{ borderColor: speaking ? ANNOUNCER_COLORS[speaking.speaker] : '#2a313c' }}
              aria-live="polite"
            >
              {speaking ? (
                <>
                  <p className="flex items-center gap-3 text-[22px] font-bold uppercase tracking-wide" style={{ color: ANNOUNCER_COLORS[speaking.speaker] }}>
                    <Mic size={26} aria-hidden />
                    {speaking.speaker === 'lead' ? t.tv.leadAnnouncer : t.tv.colorAnnouncer}
                    {muted && <span className="text-[#8b95a3]">· {t.tv.muted}</span>}
                  </p>
                  <p className="mt-2 line-clamp-3 text-[28px] leading-snug">{speaking.text}</p>
                </>
              ) : (
                <>
                  <p className="text-[22px] font-bold uppercase tracking-wide text-[#8b95a3]">{t.tv.commentary}</p>
                  <p className="mt-2 text-[24px] leading-snug text-[#c9d1dc]">{audioError || commentaryLine}</p>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#10141b] p-5">
              <p className="mb-3 text-[22px] font-bold uppercase tracking-wide text-[#8b95a3]">{t.tv.events}</p>
              {focus && state && <TvEventFeed events={focus.events} driver={focus.driver} now={state.at} />}
            </div>
          </aside>
        </div>

        {/* Controls */}
        <nav className="flex h-[76px] shrink-0 items-center gap-3">
          {!started ? (
            <button type="button" data-tv-focus autoFocus onClick={startBroadcast} className={`${controlClass} w-[440px] bg-[#e10600] text-[30px]`}>
              <Play size={34} aria-hidden />
              {t.tv.startBroadcast}
            </button>
          ) : (
            <button ref={testButton} type="button" data-tv-focus onClick={testSound} className={buttonClass}>
              <Volume2 size={28} aria-hidden />
              {t.tv.testSound}
            </button>
          )}
          {announcers && (
            <>
              <button type="button" data-tv-focus onClick={() => toggle(KEYS.commentary, !commentaryOn, setCommentaryOn)} className={buttonClass} aria-pressed={commentaryOn}>
                {t.tv.commentary}: {commentaryOn ? t.tv.on : t.tv.off}
              </button>
              <button type="button" data-tv-focus onClick={() => toggle(KEYS.lead, !lead, setLead)} className={buttonClass} aria-pressed={lead}>
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: lead ? ANNOUNCER_COLORS.lead : '#3a4350' }} aria-hidden />
                {t.tv.lead}
              </button>
              <button type="button" data-tv-focus onClick={() => toggle(KEYS.color, !color, setColor)} className={buttonClass} aria-pressed={color}>
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color ? ANNOUNCER_COLORS.color : '#3a4350' }} aria-hidden />
                {t.tv.color}
              </button>
            </>
          )}
          <button type="button" data-tv-focus onClick={() => changeVolume(-VOLUME_STEP)} className={buttonClass} aria-label={t.tv.volumeDown}>
            <Minus size={30} aria-hidden />
          </button>
          <span className="w-[170px] text-center text-[24px] tabular-nums text-[#c9d1dc]">{fmt(t.tv.volume, { n: volume })}</span>
          <button type="button" data-tv-focus onClick={() => changeVolume(VOLUME_STEP)} className={buttonClass} aria-label={t.tv.volumeUp}>
            <Plus size={30} aria-hidden />
          </button>
          <button type="button" data-tv-focus onClick={() => toggle(KEYS.muted, !muted, setMuted)} className={buttonClass} aria-pressed={muted}>
            {muted ? <VolumeX size={28} aria-hidden /> : <Volume2 size={28} aria-hidden />}
            {muted ? t.tv.unmute : t.tv.mute}
          </button>
          <div className="flex-1" />
          {(state?.drivers.length ?? 0) > 1 && (
            <button type="button" data-tv-focus onClick={nextDriver} className={buttonClass}>
              <SkipForward size={28} aria-hidden />
              {t.tv.nextDriver}
            </button>
          )}
          {fullScreenSupported && (
            <button type="button" data-tv-focus onClick={toggleFullScreen} className={buttonClass} aria-label={fullScreen ? t.tv.exitFullScreen : t.tv.fullScreen}>
              {fullScreen ? <Minimize size={28} aria-hidden /> : <Maximize size={28} aria-hidden />}
            </button>
          )}
          <button ref={settingsButton} type="button" data-tv-focus onClick={openPanel} className={buttonClass} aria-label={t.tv.settings}>
            <Settings size={28} aria-hidden />
          </button>
        </nav>
      </div>

      {panelOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
          <div ref={panelRef} role="dialog" aria-label={t.tv.settings} className="w-[880px] rounded-2xl bg-[#10141b] p-10">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[44px] font-bold">{t.tv.settings}</h2>
              <button type="button" data-tv-focus onClick={closePanel} className={buttonClass} aria-label={t.tv.close}>
                <X size={30} aria-hidden />
              </button>
            </div>
            <p className="mt-2 text-[24px] text-[#a7b0bd]">{fmt(t.tv.pairedTo, { name: userName })}</p>
            <p className="mt-8 text-[22px] uppercase tracking-wide text-[#8b95a3]">{t.tv.screenEdges}</p>
            <div className="mt-3 flex gap-3">
              {t.tv.screenEdgeValues.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  data-tv-focus
                  onClick={() => onEdges(i)}
                  aria-pressed={edges === i}
                  className={`${controlClass} ${edges === i ? 'bg-[#e10600]' : 'bg-[#1b222d]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-10 flex items-center justify-between">
              <button type="button" data-tv-focus onClick={unpair} className={`${controlClass} bg-[#3a1215]`}>
                {t.tv.unpair}
              </button>
              <p className="text-[22px] text-[#8b95a3]">{t.tv.backCloses}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
