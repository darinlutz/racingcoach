import { notFound } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import AdminSection, { AdminSectionsProvider, type AdminSectionKey } from '@/components/AdminSection';
import AdminTimeZone from '@/components/AdminTimeZone';
import AiInferenceMonitoring from '@/components/AiInferenceMonitoring';
import AiLabWorkspace from '@/components/aiLab/AiLabWorkspace';
import LocalAiServerMode from '@/components/LocalAiServerMode';
import LocalAiTestConsole from '@/components/LocalAiTestConsole';
import ModelLearningRunner from '@/components/ModelLearningRunner';
import { parseActivityFilters } from '@/lib/activityReport';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { canUseModelLearning } from '@/lib/modelLearning';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The AI Lab page (the nav bar's AI Lab link): for Admins and the accounts in modelLearning.ts only; anyone else gets a
// 404. Admins also get the AI Lab's tabs (src/components/aiLab/, docs/AI_LAB_SETUP.md): Overview, Open WebUI, Models,
// Playground, Memory, Knowledge, Model Configurations, the Fine-Tuning Lab plan, Production Routing, which holds
// the Local AI sections that used to be on the Admin page (docs/local-ai.md): Local AI Server Mode, AI Inference
// Monitoring and the Local AI Test Console. All their routes (/api/admin/ai-lab/*, /api/admin/local-ai/*) check the
// Admin role themselves. Then Run Python, the Model Learning runner (Run Model and its output), which the
// Model Learning accounts that aren't Admins get on its own under the heading, without the tabs
const LOCAL_AI_SECTIONS: AdminSectionKey[] = ['localAiMode', 'aiInference', 'localAiTest'];

export default async function ModelLearningPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user || !canUseModelLearning(user)) notFound();
  const t = getDictionary(await getLanguage()).modelLearning;
  const admin = isAdmin(user.role);
  const params = await searchParams;
  // Only the time zone, which AdminTimeZone adds to the address
  const { timeZone } = parseActivityFilters({ tz: params.tz });

  return (
    <div className="w-full" data-no-track={admin ? true : undefined}>
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.title}
          </h1>
        </div>
      </section>

      {admin && (
        <section className="pt-10 px-4">
          <AdminTimeZone current={typeof params.tz === 'string' ? params.tz : null} />
          <AiLabWorkspace
            production={
              <AdminSectionsProvider keys={LOCAL_AI_SECTIONS} initiallyOpen={[]}>
                <div className="space-y-4">
                  <AdminNav sections={LOCAL_AI_SECTIONS} />

                  <AdminSection section="localAiMode">
                    <LocalAiServerMode />
                  </AdminSection>

                  <AdminSection section="aiInference">
                    <AiInferenceMonitoring timeZone={timeZone} />
                  </AdminSection>

                  <AdminSection section="localAiTest">
                    <LocalAiTestConsole />
                  </AdminSection>
                </div>
              </AdminSectionsProvider>
            }
            runPython={
              <div className="max-w-4xl mx-auto bg-secondary rounded-xl border border-border p-8">
                <ModelLearningRunner />
              </div>
            }
          />
        </section>
      )}

      {!admin && (
        <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
          <div className="w-full max-w-4xl">
            <div className="bg-secondary rounded-xl border border-border p-8">
              <ModelLearningRunner />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
