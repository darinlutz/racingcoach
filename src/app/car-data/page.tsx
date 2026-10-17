import CarDataManagement from '@/components/CarDataManagement';
import { getDictionary, getLanguage } from '@/lib/i18n/server';

// Car Data: each driver's own cars and their specs (the nav bar's Car Data link)
export default async function CarDataPage() {
  const t = getDictionary(await getLanguage()).racing;
  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.tabs.cars}
          </h1>
          <p className="text-lg text-muted-foreground">{t.intros.cars}</p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl">
          <div className="bg-secondary rounded-xl border border-border p-8">
            <CarDataManagement />
          </div>
        </div>
      </section>
    </div>
  );
}
