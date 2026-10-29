import { NextResponse } from 'next/server';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { clientIp } from '@/lib/rateLimits';
import { claimPairing, overAttemptLimit, startPairing } from '@/lib/tvAuth';
import { formatPairingCode } from '@/lib/tvPairingCode';

// TV Broadcast Mode's pairing, from the TV (src/lib/tvAuth.ts):
//   POST  a new pairing code to show, { code, expiresAt } (the TV's tv_pairing cookie can claim it); at most
//         CODES_PER_IP every 10 minutes from one IP address
//   GET   whether the code was entered: { status: 'pending' | 'paired' | 'expired' | 'none' }; 'paired' comes with the
//         TV's tv_session cookie

const CODES_PER_IP = 20;

export async function POST(request: Request) {
  const t = getDictionary(await getLanguage(null)).tv;
  try {
    if (overAttemptLimit(`tv-pair:${clientIp(request) ?? ''}`, CODES_PER_IP, 10 * 60_000)) {
      return NextResponse.json({ error: t.tooManyCodes }, { status: 429 });
    }
    const { code, expiresAt } = await startPairing(request.headers.get('user-agent'));
    return NextResponse.json({ code: formatPairingCode(code), expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('TV pairing error:', error);
    return NextResponse.json({ error: t.pairFailedApi }, { status: 500 });
  }
}

export async function GET() {
  const t = getDictionary(await getLanguage(null)).tv;
  try {
    const result = await claimPairing();
    return NextResponse.json({ status: result.status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('TV pairing status error:', error);
    return NextResponse.json({ error: t.pairFailedApi }, { status: 500 });
  }
}
