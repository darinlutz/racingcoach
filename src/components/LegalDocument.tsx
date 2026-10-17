import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import type { LegalBlock, LegalDocumentContent } from '@/lib/legal';

// A Privacy Policy or Terms of Service page (src/lib/legal.ts), in English whatever the Preferred Language
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
          <div key={section.heading} className="space-y-4 leading-relaxed">
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
