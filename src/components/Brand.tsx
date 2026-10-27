'use client';

import Link from 'next/link';
import { Flag } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';

// RacingCoach.app wordmark: red flag + condensed RACINGCOACH.APP with tagline. aiFeatures is the Admin page's
// Enable AI Features setting: the tagline says AI race engineer when on, personal race engineer when off.
// compact is the smaller size that fits the nav sidebar
export default function Brand({ onClick, aiFeatures = true, compact = false }: { onClick?: () => void; aiFeatures?: boolean; compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <Link href="/" className={`flex items-center ${compact ? 'gap-[9px]' : 'gap-[11px]'}`} aria-label={t.brand.home} onClick={onClick}>
      <Flag className={`${compact ? 'w-[28px] h-[29px]' : 'w-[34px] h-[35px]'} shrink-0 text-primary`} strokeWidth={2.5} />
      <div>
        <div className={`font-display font-bold leading-none ${compact ? 'text-[22px]' : 'text-[27px] max-sm:text-[23px]'}`}>
          RACING<span className="font-normal text-muted-foreground">COACH</span>
          <span className="font-normal text-primary">.APP</span>
        </div>
        <span className={`block mt-[5px] text-muted-foreground ${compact ? 'text-[7px] tracking-[1.8px]' : 'text-[8px] tracking-[2.5px]'}`}>{aiFeatures ? t.brand.tagline : t.brand.taglineNoAi}</span>
      </div>
    </Link>
  );
}
