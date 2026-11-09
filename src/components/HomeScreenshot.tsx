import fs from 'fs';
import path from 'path';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';

// A Home page screenshot in a window frame. The picture is public/assets/home/<name>.webp (or .png or
// .jpg); until that file is added, the frame shows a stand-in with the screenshot's title, so the page
// can go up before every screenshot is taken.
const EXTENSIONS = ['webp', 'png', 'jpg'];

function screenshotSrc(name: string) {
  for (const ext of EXTENSIONS) {
    const file = `${name}.${ext}`;
    if (fs.existsSync(path.join(process.cwd(), 'public', 'assets', 'home', file))) return `/assets/home/${file}`;
  }
  return null;
}

export default function HomeScreenshot({
  name,
  title,
  alt,
  pending,
  aspect = '16 / 9',
  sizes = '(max-width: 800px) 100vw, 60vw',
}: {
  name: string;
  // The title in the frame's bar, and the stand-in's caption
  title: string;
  alt: string;
  // The dictionary's "Screenshot coming soon"
  pending: string;
  aspect?: string;
  sizes?: string;
}) {
  const src = screenshotSrc(name);
  return (
    <figure className="shot">
      <div className="shot-bar" aria-hidden="true">
        <span /><span /><span />
        <em>{title}</em>
      </div>
      <div className="shot-body" style={{ aspectRatio: aspect }}>
        {src ? (
          <Image src={src} alt={alt} fill sizes={sizes} className="shot-image" />
        ) : (
          <div className="shot-pending" role="img" aria-label={alt}>
            <ImageIcon />
            <strong>{title}</strong>
            <span>{pending}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
