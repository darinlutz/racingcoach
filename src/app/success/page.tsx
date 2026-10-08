import Link from 'next/link';
import Stripe from 'stripe';

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

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8 text-center">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {isComplete ? 'Thank You!' : 'Payment Not Confirmed'}
        </h1>
        <p className="text-muted-foreground mb-8">
          {isComplete
            ? `${
                session.mode === 'payment'
                  ? 'Your lifetime subscription is active.'
                  : 'Your subscription is active.'
              }${
                session.customer_details?.email
                  ? ` A receipt has been sent to ${session.customer_details.email}.`
                  : ''
              }`
            : "We couldn't confirm your payment. If you were charged, please contact us."}
        </p>

        <Link
          href="/account"
          className="inline-block px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
        >
          Back to My Account
        </Link>
      </div>
    </section>
  );
}
