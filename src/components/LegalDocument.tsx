import Link from 'next/link';
import { buttonVariants } from '@/components/Button';
import CookieSettingsButton from '@/components/CookieSettingsButton';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import type { LegalBlock, LegalDocumentContent } from '@/lib/legal';

// A Privacy Policy, Terms of Service or Cookie Policy page (src/lib/legal.ts), in English whatever the Preferred Language
export default function LegalDocument({ doc, t }: { doc: LegalDocumentContent; t: Dictionary['legal'] }) {
  return (
    <section className="py-10 px-4">
      <article lang="en" className="site-container max-w-3xl space-y-6">
        <Link href="/legal" className="text-sm text-primary hover:underline">← {t.backToLegal}</Link>
        {t.englishOnly && (
          <p lang="" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {t.englishOnly}
          </p>
        )}
        <header className="space-y-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {doc.title}
          </h1>
          <p className="text-sm text-muted-foreground">Effective Date: {doc.effectiveDate}</p>
        </header>
        <div className="space-y-4 leading-relaxed">
          {doc.intro.map((block, i) => <Block key={i} block={block} />)}
        </div>
        {doc.sections.map((section) => (
          <div key={section.heading} id={section.id} className="space-y-4 leading-relaxed scroll-mt-24">
            <h2 className="text-xl font-semibold pt-2">{section.heading}</h2>
            {section.blocks.map((block, i) => <Block key={i} block={block} />)}
          </div>
        ))}
      </article>
    </section>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === 'string') return <p>{block}</p>;
  if ('strong' in block) return <p className="font-semibold">{block.strong}</p>;
  if ('subheading' in block) return <h3 className="font-semibold pt-1">{block.subheading}</h3>;
  if ('list' in block) {
    return (
      <ul className="list-disc pl-6 space-y-1">
        {block.list.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  if ('cookieSettings' in block) {
    return (
      <p>
        <CookieSettingsButton label={block.cookieSettings} className={buttonVariants({ variant: 'racingOutline', size: 'sm' })} />
      </p>
    );
  }
  if ('table' in block) {
    // Scrolls sideways on its own on a narrow screen, so the page doesn't
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm text-left">
          <caption className="sr-only">{block.table.caption}</caption>
          <thead className="bg-card">
            <tr>
              {block.table.headers.map((header) => (
                <th key={header} scope="col" className="px-3 py-2 font-semibold">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {block.table.rows.map((row) => (
              <tr key={row[0]} className="align-top">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-2 font-mono text-xs font-normal break-words max-w-[12rem]">{cell}</th>
                  ) : (
                    <td key={i} className="px-3 py-2">{cell}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {block.contact.map((line) => (
        <p key={line.text}>
          {line.label && <>{line.label}: </>}
          {line.href
            ? <a href={line.href} className="text-primary hover:underline">{line.text}</a>
            : <span className="font-semibold">{line.text}</span>}
        </p>
      ))}
    </div>
  );
}
