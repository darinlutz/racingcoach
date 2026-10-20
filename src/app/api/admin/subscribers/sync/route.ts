import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { importStripeSubscriptions, type ImportResult } from '@/lib/stripeBilling';
import { stripeClient } from '@/lib/stripePlans';

// The Subscribers page's Sync from Stripe: imports every subscription in the Stripe account and its discounts
// (src/lib/stripeBilling.ts importStripeSubscriptions). Safe to run again. Admin role only; anyone else gets a 404.
// One at a time per server, so a double click doesn't run it twice.

// A big Stripe account takes a while: one request per subscription for its invoices, plus a preview of the next one
export const maxDuration = 300;

let running: Promise<ImportResult> | null = null;

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const stripe = stripeClient();
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 });
    }
    if (!running) {
      running = importStripeSubscriptions(stripe).finally(() => {
        running = null;
      });
    }
    const result = await running;
    console.log(`Stripe subscriber sync by user ${user.id}:`, result);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Stripe subscriber sync error:', error);
    return NextResponse.json({ error: 'Failed to sync from Stripe' }, { status: 500 });
  }
}
