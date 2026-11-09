import { Check } from 'lucide-react';
import HomeScreenshot from '@/components/HomeScreenshot';

// A Home page feature: its text and points beside a screenshot, the screenshot on the left when reversed
export default function HomeShowcase({
  id,
  eyebrow,
  title,
  copy,
  points,
  shot,
  reverse = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  copy: string;
  points: readonly string[];
  shot: React.ComponentProps<typeof HomeScreenshot>;
  reverse?: boolean;
}) {
  return (
    <div className={`showcase${reverse ? ' showcase-reverse' : ''}`} id={id}>
      <div className="showcase-text">
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="feature-title">{title}</h2>
        <p className="muted-copy">{copy}</p>
        <ul className="check-list">
          {points.map((point) => <li key={point}><Check />{point}</li>)}
        </ul>
      </div>
      <HomeScreenshot {...shot} />
    </div>
  );
}
