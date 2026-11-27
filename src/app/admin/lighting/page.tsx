import Link from 'next/link';
import { notFound } from 'next/navigation';
import LightingControl from '@/components/LightingControl';
import { canUseLighting } from '@/lib/lighting/devices';
import { getDictionary } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';

// Admin > Lighting Control (docs/lighting/README.md): pair the Mac lighting agent, see what it's doing, send Test Lab
// events, and set up Stream Deck. Admins only while it's being built, and off with LIGHTING_CONTROL=off; anyone else
// gets a 404, so the page's existence isn't advertised.
export default async function AdminLightingPage() {
  const user = await getCurrentUser();
  if (!user || !canUseLighting(user)) notFound();
  const t = getDictionary(user.preferredLanguage).lightingControl;
  return (
    <section className="py-10 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary">← {t.backToAdmin}</Link>
        <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-wide text-foreground">{t.title}</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">{t.intro}</p>
        <LightingControl />
      </div>
    </section>
  );
}
