import { notFound } from 'next/navigation';
import ModelLearningRunner from '@/components/ModelLearningRunner';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { canUseModelLearning } from '@/lib/modelLearning';
import { getCurrentUser } from '@/lib/session';

// For Admins and the accounts in modelLearning.ts only, like the nav bar's Model Learning link; anyone else gets a 404
export default async function ModelLearningPage() {
  const user = await getCurrentUser();
  if (!user || !canUseModelLearning(user)) notFound();
  const t = getDictionary(await getLanguage()).modelLearning;
  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.title}
          </h1>
          <p className="text-lg text-muted-foreground">{t.intro}</p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl">
          <div className="bg-secondary rounded-xl border border-border p-8">
            <ModelLearningRunner />
          </div>
        </div>
      </section>
    </div>
  );
}
