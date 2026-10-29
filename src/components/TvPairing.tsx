'use client';

import { RefreshCw, Tv } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { useTvRemote } from '@/components/useTvRemote';

// TV Broadcast Mode's pairing screen (src/lib/tvAuth.ts): a code to type on the TV Link page of a signed-in browser,
// asked for again when it expires. The TV checks every few seconds whether it was entered, then reloads as paired.

const CHECK_MS = 3000;
const RETRY_MS = 10_000;

export default function TvPairing({ linkAddress }: { linkAddress: string }) {
  const { t, fmt } = useLanguage();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const asking = useRef(false);
  const scope = useRef<HTMLDivElement>(null);
  useTvRemote(scope, null);

  const newCode = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      const response = await fetch('/api/tv/pair', { method: 'POST', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.code) throw new Error(data.error || t.tv.pairFailed);
      setCode({ code: data.code, expiresAt: data.expiresAt });
      setError('');
    } catch (err) {
      setCode(null);
      setError(err instanceof Error ? err.message : t.tv.pairFailed);
    } finally {
      asking.current = false;
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first code, once the page is showing
    newCode();
  }, [newCode]);

  // Every second: the countdown, a new code once this one expires (or after a failure), and every CHECK_MS whether
  // it was entered
  useEffect(() => {
    let lastCheck = 0;
    let lastFailure = 0;
    const timer = window.setInterval(async () => {
      const at = Date.now();
      setNow(at);
      if (!code) {
        if (at - lastFailure > RETRY_MS) {
          lastFailure = at;
          newCode();
        }
        return;
      }
      if (at >= code.expiresAt) {
        newCode();
        return;
      }
      if (at - lastCheck < CHECK_MS) return;
      lastCheck = at;
      try {
        const response = await fetch('/api/tv/pair', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (data.status === 'paired') window.location.reload();
        else if (data.status === 'expired' || data.status === 'none') newCode();
      } catch {
        // offline for a moment: checked again shortly
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code, newCode]);

  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const countdown = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div ref={scope} className="h-full flex flex-col items-center justify-center text-center gap-10">
      <div className="flex items-center gap-5 text-[#e10600]">
        <Tv size={72} aria-hidden />
        <span className="font-display text-[64px] font-bold tracking-wide text-white">RACINGCOACH.APP</span>
      </div>
      <h1 className="font-display text-[56px] font-semibold">{t.tv.pairHeading}</h1>
      <div className="text-[34px] leading-snug text-[#c9d1dc]">
        <p>{t.tv.pairStep1}</p>
        <p className="mt-2 font-bold text-[44px] text-white">{linkAddress}</p>
        <p className="mt-6">{t.tv.pairStep2}</p>
      </div>
      <div
        className="rounded-2xl border-4 border-[#e10600] bg-[#10141b] px-16 py-8 font-mono text-[120px] font-bold tracking-[0.12em] text-white"
        aria-live="polite"
      >
        {code?.code ?? '····-····'}
      </div>
      <p className="text-[30px] text-[#c9d1dc] min-h-[40px]">
        {error || (code ? `${fmt(t.tv.pairExpires, { time: countdown })} · ${t.tv.pairWaiting}` : '')}
      </p>
      <button
        type="button"
        data-tv-focus
        autoFocus
        onClick={() => newCode()}
        className="flex items-center gap-4 rounded-xl bg-[#1b222d] px-10 py-5 text-[30px] font-semibold outline-none focus:ring-[6px] focus:ring-[#ffd400]"
      >
        <RefreshCw size={32} aria-hidden />
        {t.tv.pairNewCode}
      </button>
      <p className="text-[24px] text-[#8b95a3]">{t.tv.pairNote}</p>
    </div>
  );
}
