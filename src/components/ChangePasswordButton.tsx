'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

const inputClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

// The Account page's Change Password button and its form: the current password, then the new one twice
export default function ChangePasswordButton() {
  const { t: dictionary } = useLanguage();
  const t = dictionary.changePassword;
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const openForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setDone(false);
    setOpen(true);
  };

  const close = () => {
    if (!submitting) setOpen(false);
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError(dictionary.api.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.failed);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={openForm}
        className="w-full px-6 py-3 rounded-lg font-semibold text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors"
      >
        {t.button}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="changePasswordTitle"
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="changePasswordTitle" className="text-lg font-bold text-foreground mb-1">
              {t.title}
            </h2>
            {done ? (
              <>
                <p className="text-sm text-muted-foreground mb-6">{t.done}</p>
                <button
                  type="button"
                  autoFocus
                  onClick={close}
                  className="w-full px-4 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong"
                >
                  {dictionary.common.done}
                </button>
              </>
            ) : (
              <form onSubmit={(event) => void changePassword(event)}>
                <p className="text-sm text-muted-foreground mb-4">{t.intro}</p>

                <label htmlFor="currentPassword" className="block text-sm font-medium text-foreground mb-2">
                  {t.current}
                </label>
                <input
                  type="password"
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                  className={`${inputClass} mb-4`}
                />

                <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-2">
                  {t.new}{' '}
                  <span className="font-normal text-muted-foreground">{dictionary.common.passwordHint}</span>
                </label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={`${inputClass} mb-4`}
                />

                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                  {t.confirm}
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={`${inputClass} mb-4`}
                />

                {error && (
                  <p className="mb-4 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{error}</p>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={close}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 rounded-lg font-semibold text-foreground bg-card border border-border hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    {dictionary.common.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? t.changing : t.button}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
