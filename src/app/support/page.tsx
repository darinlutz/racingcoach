import SupportForm from '@/components/SupportForm';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_SUPPORT_DESCRIPTION } from '@/lib/supportRequest';

// The Support page: the user describes an issue and Send Report emails it to the site owner
// (POST /api/support). Name and email start as the signed-in user's; visitors type their own.
export default async function SupportPage() {
  const user = await getCurrentUser();
  const t = getDictionary(await getLanguage(user)).support;

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.pageTitle}
        </h1>
        <SupportForm
          name={user?.userName ?? ''}
          email={user?.emailAddress ?? ''}
          maxLength={MAX_SUPPORT_DESCRIPTION}
        />
      </div>
    </section>
  );
}
