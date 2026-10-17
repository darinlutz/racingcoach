'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Account page's Delete Account button (not shown to Admins) and its warning. Confirming deletes the account and
// all of its data (DELETE /api/account), then goes to the home page signed out. The warning fades and scales in like
// ConfirmDialog; Escape or a click outside closes it unless the deletion is under way, and Cancel has focus when it opens.
export default function DeleteAccountButton({ isSubscribed }: { isSubscribed: boolean }) {
  const { t: dictionary } = useLanguage();
  const t = dictionary.deleteAccount;
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const openWarning = () => {
    setError('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, deleting]);

  const close = () => {
    if (!deleting) setOpen(false);
  };

  const deleteAccount = async () => {
    setError('');
    setDeleting(true);
    try {
      const response = await fetch('/api/account', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.failed);
      // Signed out now: off to the home page, refreshed so the nav bar forgets the account
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
      setDeleting(false);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-border">
      <button
        type="button"
        onClick={openWarning}
        className="w-full px-6 py-3 rounded-lg font-semibold text-red-500 bg-card border border-red-500/40 hover:bg-red-500/10 hover:border-red-500 transition-colors"
      >
        {t.button}
      </button>

      <div
        aria-hidden={!open}
        onClick={close}
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-[opacity,visibility] duration-200 ease-out ${
          open ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
        }`}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="deleteAccountTitle"
          aria-describedby="deleteAccountIntro"
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-red-500/40 p-6 shadow-xl transition-transform duration-200 ease-out ${
            open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
          }`}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15 text-red-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 id="deleteAccountTitle" className="text-lg font-bold text-foreground">
                {t.title}
              </h2>
              <p id="deleteAccountIntro" className="mt-1 text-sm font-medium text-red-500">
                {t.intro}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg bg-secondary border border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground mb-2">{t.listIntro}</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {t.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-red-500" aria-hidden="true">
                    ✕
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {isSubscribed && <p className="mt-4 text-sm text-muted-foreground">{t.subscription}</p>}

          {error && (
            <p className="mt-4 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>
          )}

          <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
            <button
              ref={cancelRef}
              type="button"
              onClick={close}
              disabled={deleting}
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {dictionary.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void deleteAccount()}
              disabled={deleting}
              className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? t.deleting : t.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
