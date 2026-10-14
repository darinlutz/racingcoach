import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getProDriverBio } from '@/lib/proDriverBio';
import { getCurrentUser } from '@/lib/session';

const RACING_STYLES = ['sportsCar', 'formula', 'stockCar', 'dirt', 'offRoad'] as const;

// The bio's **bold** and *italic* markup
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.length > 1) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

// The Pro Driving Lesson page (the nav bar's Pro Driver Lesson link): the coach's bio (src/lib/proDriverBio.ts),
// then the lesson form, where the driver picks a racing style, writes their goals and picks 1 or 2 hours.
// The hour buttons do nothing yet.
export default async function ProDrivingLessonPage() {
  const user = await getCurrentUser();
  const language = await getLanguage(user);
  const t = getDictionary(language).proDrivingLesson;
  const bio = getProDriverBio(language);

  const buttonClass =
    'px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors';

  return (
    <section className="py-10 px-4">
      <div className="site-container space-y-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.pageTitle}
        </h1>

        <article className="bg-card rounded-xl border border-border p-4 sm:p-6 space-y-6">
          <h2 className="text-2xl font-bold text-foreground">{bio.title}</h2>
          {bio.sections.map((section) => (
            <div key={section.heading} className="space-y-3">
              <h3 className="text-lg font-semibold text-primary">{section.heading}</h3>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i} className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                  {renderInline(paragraph)}
                </p>
              ))}
            </div>
          ))}
        </article>

        <form className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <fieldset>
            <legend className="block text-sm font-semibold text-foreground mb-2">{t.racingStyle}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {RACING_STYLES.map((style) => (
                <label key={style} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="radio" name="racingStyle" value={style} className="accent-primary" />
                  {t[style]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="lesson-goals" className="block text-sm font-semibold text-foreground mb-1">
              {t.lessonGoals}
            </label>
            <textarea
              id="lesson-goals"
              name="lessonGoals"
              rows={6}
              placeholder={t.goalsPlaceholder}
              className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>

          <div className="flex gap-3">
            <button type="button" className={buttonClass}>{t.oneHour}</button>
            <button type="button" className={buttonClass}>{t.twoHours}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
