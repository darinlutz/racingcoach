import Link from 'next/link';
import Stripe from 'stripe';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';

async function getCheckoutSession(sessionId: string | undefined) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!sessionId || !stripeSecretKey) return null;

  try {
    const stripe = new Stripe(stripeSecretKey);
    return await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error('Stripe session lookup error:', error);
    return null;
  }
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { session_id } = await searchParams;
  const session = await getCheckoutSession(
    typeof session_id === 'string' ? session_id : undefined
  );
  const isComplete = session?.status === 'complete';
  const t = getDictionary(await getLanguage()).success;

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8 text-center">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {isComplete ? t.thankYou : t.notConfirmed}
        </h1>
        <p className="text-muted-foreground mb-8">
          {isComplete
            ? t.active + (session.customer_details?.email ? fmt(t.receipt, { email: session.customer_details.email }) : '')
            : t.couldNotConfirm}
        </p>

        <Link
          href="/account"
          className="inline-block px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
        >
          {t.backToAccount}
        </Link>
      </div>
    </section>
  );
}
