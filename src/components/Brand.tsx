import Link from 'next/link';
import { Flag } from 'lucide-react';

// RacingCoach.app wordmark: red flag + condensed RACINGCOACH.APP with tagline
export default function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" className="flex items-center gap-[11px]" aria-label="RacingCoach.app home" onClick={onClick}>
      <Flag className="w-[34px] h-[35px] text-primary" strokeWidth={2.5} />
      <div>
        <div className="font-display font-bold text-[27px] leading-none max-sm:text-[23px]">
          RACING<span className="font-normal text-muted-foreground">COACH</span>
          <span className="font-normal text-primary">.APP</span>
        </div>
        <span className="block mt-[5px] text-[8px] tracking-[2.5px] text-muted-foreground">YOUR AI RACE ENGINEER</span>
      </div>
    </Link>
  );
}
