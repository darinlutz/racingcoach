import PrivacyRequestVerify from '@/components/PrivacyRequestVerify';
import { getDictionary, getLanguage } from '@/lib/i18n/server';

// Where the emailed link of a privacy request made without signing in lands (/privacy-request/verify?token=)
export default async function PrivacyRequestVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = getDictionary(await getLanguage()).privacyRights.public;
  const { token } = await searchParams;
  return (
    <section className="py-12 px-4 flex justify-center">
      <div className="w-full max-w-xl bg-secondary rounded-xl border border-border p-6 sm:p-8" data-no-track>
        <h1 className="text-2xl font-bold mb-2 text-foreground">{t.verifyTitle}</h1>
        <p className="text-muted-foreground mb-6">{t.verifyIntro}</p>
        <PrivacyRequestVerify token={typeof token === 'string' ? token : ''} />
      </div>
    </section>
  );
}
