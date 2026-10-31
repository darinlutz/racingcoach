'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';
import ProfilePictureCropper from '@/components/ProfilePictureCropper';
import { MAX_PICTURE_SOURCE_BYTES } from '@/lib/profilePictureRules';

const iconButton =
  'absolute bottom-1 flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';

// My Dashboard's picture: the red helmet until the driver adds their own. The camera icon picks a file on the computer,
// and ProfilePictureCropper positions and scales it; only that square, as a JPEG, leaves the browser (/api/account/picture).
export default function ProfilePicture({ version: initial }: { version: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const p = t.myDashboard.picture;
  const [version, setVersion] = useState(initial);
  const [picked, setPicked] = useState<HTMLImageElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeConfirm = useCallback(() => setConfirmRemove(false), []);

  // The picked file's temporary URL goes with it, also when the page is left with it open
  useEffect(() => {
    if (!picked) return;
    return () => URL.revokeObjectURL(picked.src);
  }, [picked]);

  const pick = (file: File | undefined) => {
    setError('');
    setSaveError('');
    if (!file) return;
    if (file.size > MAX_PICTURE_SOURCE_BYTES) {
      setError(p.tooLarge);
      return;
    }
    // The browser decides what it can read: a HEIC from an iPhone, say, fails here on most of them
    const image = new window.Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setPicked(image);
      } else {
        URL.revokeObjectURL(url);
        setError(p.unreadable);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError(p.unreadable);
    };
    image.src = url;
  };

  const save = async (picture: Blob) => {
    setSaving(true);
    setSaveError('');
    try {
      const form = new FormData();
      form.append('file', picture, 'picture.jpg');
      const response = await fetch('/api/account/picture', { method: 'PUT', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveError(data.error ?? p.failedSave);
        return;
      }
      setVersion(data.version);
      setPicked(null);
      // The sidebar shows it too
      router.refresh();
    } catch {
      setSaveError(p.failedSave);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setError('');
    try {
      const response = await fetch('/api/account/picture', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setVersion(null);
      router.refresh();
    } catch {
      setError(p.failedRemove);
    }
  };

  return (
    <div className="relative w-full max-w-56 md:max-w-64">
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element -- the signed-in user's own private picture, already 512 pixels
        <img
          src={`/api/account/picture?v=${encodeURIComponent(version)}`}
          alt={p.alt}
          width={512}
          height={512}
          className="aspect-square w-full rounded-full object-cover shadow-2xl ring-4 ring-primary/70"
        />
      ) : (
        <Image
          src="/assets/dashboard/helmet.webp"
          alt={t.myDashboard.helmetAlt}
          width={640}
          height={640}
          sizes="(min-width: 768px) 16rem, 14rem"
          preload
          className="w-full -rotate-6 drop-shadow-2xl"
        />
      )}
      <button
        type="button"
        data-track="change-profile-picture"
        onClick={() => inputRef.current?.click()}
        aria-label={p.change}
        title={p.change}
        className={`${iconButton} right-1`}
      >
        <Camera className="size-5" aria-hidden />
      </button>
      {version && (
        <button
          type="button"
          data-track="remove-profile-picture"
          onClick={() => setConfirmRemove(true)}
          aria-label={p.remove}
          title={p.remove}
          className={`${iconButton} left-1`}
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label={p.change}
        tabIndex={-1}
        data-no-track
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          // So picking the same file again still counts as a change
          e.target.value = '';
        }}
      />
      {error && (
        <p role="alert" className="absolute inset-x-0 top-full mt-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}
      {picked && (
        <ProfilePictureCropper
          key={picked.src}
          image={picked}
          saving={saving}
          error={saveError}
          onSave={(picture) => void save(picture)}
          onCancel={() => setPicked(null)}
        />
      )}
      <ConfirmDialog
        open={confirmRemove}
        title={p.removeTitle}
        confirmLabel={t.common.remove}
        cancelLabel={t.common.cancel}
        onConfirm={() => void remove()}
        onCancel={closeConfirm}
      >
        {p.removeText}
      </ConfirmDialog>
    </div>
  );
}
