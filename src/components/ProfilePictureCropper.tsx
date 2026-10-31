'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, X } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { clampPan, cropSquare, MAX_PICTURE_ZOOM, panAfterZoom, pictureBox, PROFILE_PICTURE_PIXELS, type PicturePan } from '@/lib/profilePictureRules';

// The frame's size on screen, in CSS pixels
const FRAME = 288;
const KEY_STEP = 12;

// The picture a person picked, in a round frame: dragging or the arrow keys move it and the slider scales it. Saving
// draws what's in the frame to a square JPEG for onSave. In a portal, as My Dashboard's hero has an animated transform
// that a fixed box would otherwise sit inside.
export default function ProfilePictureCropper({
  image,
  saving,
  error,
  onSave,
  onCancel,
}: {
  image: HTMLImageElement;
  saving: boolean;
  error: string;
  onSave: (picture: Blob) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const p = t.myDashboard.picture;
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PicturePan>({ x: 0, y: 0 });
  const drag = useRef<{ pointerX: number; pointerY: number; pan: PicturePan } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // The latest onCancel, so a new function from each render doesn't rerun the effect below
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frameRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  const moveTo = (next: PicturePan) => setPan(clampPan(next, size, zoom, FRAME));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const move: Record<string, PicturePan> = {
      ArrowLeft: { x: pan.x - KEY_STEP, y: pan.y },
      ArrowRight: { x: pan.x + KEY_STEP, y: pan.y },
      ArrowUp: { x: pan.x, y: pan.y - KEY_STEP },
      ArrowDown: { x: pan.x, y: pan.y + KEY_STEP },
    };
    if (!move[e.key]) return;
    e.preventDefault();
    moveTo(move[e.key]);
  };

  const changeZoom = (next: number) => {
    setPan(panAfterZoom(pan, size, zoom, next, FRAME));
    setZoom(next);
  };

  const save = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_PICTURE_PIXELS;
    canvas.height = PROFILE_PICTURE_PIXELS;
    const context = canvas.getContext('2d');
    if (!context) return;
    const crop = cropSquare(pan, size, zoom, FRAME);
    // A see-through PNG would otherwise turn black in a JPEG
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && onSave(blob), 'image/jpeg', 0.9);
  };

  const box = pictureBox(pan, size, zoom, FRAME);

  return createPortal(
    <div onClick={onCancel} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profilePictureTitle"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="h-1 bg-gradient-to-r from-primary-strong via-primary to-primary-strong" />
        <button
          type="button"
          onClick={onCancel}
          aria-label={t.common.close}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6">
          <h2 id="profilePictureTitle" className="pr-6 text-lg font-bold text-foreground">{p.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{p.hint}</p>
          <div
            ref={frameRef}
            tabIndex={0}
            role="group"
            aria-label={p.frame}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { pointerX: e.clientX, pointerY: e.clientY, pan };
            }}
            onPointerMove={(e) => {
              if (drag.current) moveTo({ x: drag.current.pan.x + e.clientX - drag.current.pointerX, y: drag.current.pan.y + e.clientY - drag.current.pointerY });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            style={{ width: FRAME, height: FRAME }}
            className="relative mx-auto mt-4 max-w-full cursor-move touch-none select-none overflow-hidden rounded-lg bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local file the person just picked, not something next/image can serve */}
            <img
              src={image.src}
              alt=""
              draggable={false}
              style={{ position: 'absolute', maxWidth: 'none', width: box.width, height: box.height, left: box.left, top: box.top }}
            />
            {/* The picture shows in a circle on My Dashboard; the corners stay dim */}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" aria-hidden />
          </div>
          <label className="mt-4 flex items-center gap-3">
            <span className="sr-only">{p.scale}</span>
            <ZoomOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={1}
              max={MAX_PICTURE_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </label>
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={onCancel} className={buttonVariants({ variant: 'racingOutline', className: 'flex-1' })}>
              {t.common.cancel}
            </button>
            <button type="button" onClick={save} disabled={saving} className={buttonVariants({ variant: 'racing', className: 'flex-1' })}>
              {saving ? t.common.saving : p.save}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
