import { Sparkles } from 'lucide-react';

type SummaryPanelProps = {
  title: string;
  // The coach's prose; paragraphs are separated by blank lines
  text: string;
  // Shown, dimmed, while there's no text yet
  placeholder: string;
  // The text is a "writing…" message rather than the summary
  pending?: boolean;
};

// The coach's written summary (Lap Compare), as easy-to-read paragraphs under a heading rather than in a text box
export default function SummaryPanel({ title, text, placeholder, pending = false }: SummaryPanelProps) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section aria-live="polite" className="rounded-xl border border-border border-l-4 border-l-primary bg-card px-5 py-5 sm:px-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
        {title}
      </h3>
      {paragraphs.length === 0 ? (
        <p className="mt-3 text-base text-muted-foreground">{placeholder}</p>
      ) : pending ? (
        <p className="mt-3 text-base text-muted-foreground animate-pulse">{paragraphs.join(' ')}</p>
      ) : (
        <div className="mt-3 space-y-4 text-base leading-relaxed text-foreground">
          {paragraphs.map((paragraph, i) => (
            <p key={i} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
