'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useLanguage } from '@/components/LanguageProvider';

// The site's own confirmation boxes in place of the browser's window.confirm and window.prompt, for every page (in the
// root layout): `const ask = useConfirm()`, then `if (!(await ask.confirm({ message }))) return;`, or
// `const text = await ask.prompt({ message })` (null when cancelled). One box at a time, in ConfirmDialog's style;
// Escape or a click outside cancels. A new confirmation should use this, never window.confirm, alert or prompt.

type ConfirmOptions = {
  message: ReactNode;
  // Defaults to "Are you sure?"
  title?: string;
  // The buttons' words: Delete or Remove and Cancel, Confirm and Cancel (the default), or Yes and No for a question
  action?: 'delete' | 'remove' | 'confirm' | 'yesNo';
  // In place of the action's words
  confirmLabel?: string;
  cancelLabel?: string;
  // danger (the default): a red confirm button, for deleting or what can't be undone; primary otherwise
  tone?: 'danger' | 'primary';
};
type PromptOptions = ConfirmOptions & { placeholder?: string };

type Asking =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (text: string | null) => void };

type Ask = { confirm: (options: ConfirmOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> };

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm needs ConfirmProvider');
  return ask;
}

export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [asking, setAsking] = useState<Asking | null>(null);
  // Kept while the box fades out, so its text doesn't vanish as it closes
  const [shown, setShown] = useState<Asking | null>(null);
  const [text, setText] = useState('');
  const current = useRef<Asking | null>(null);

  const open = useCallback((next: Asking) => {
    // A box already open is cancelled first
    const before = current.current;
    if (before) {
      if (before.kind === 'confirm') before.resolve(false);
      else before.resolve(null);
    }
    current.current = next;
    setText('');
    setAsking(next);
    setShown(next);
  }, []);
  const close = useCallback((answer: boolean, typed = '') => {
    const was = current.current;
    current.current = null;
    setAsking(null);
    if (!was) return;
    if (was.kind === 'confirm') was.resolve(answer);
    else was.resolve(answer ? typed : null);
  }, []);
  const cancel = useCallback(() => close(false), [close]);

  const ask = useMemo<Ask>(
    () => ({
      confirm: (options) => new Promise<boolean>((resolve) => open({ kind: 'confirm', options, resolve })),
      prompt: (options) => new Promise<string | null>((resolve) => open({ kind: 'prompt', options, resolve })),
    }),
    [open]
  );

  const options = shown?.options;
  const c = t.common;
  const words = {
    delete: [c.delete, c.cancel],
    remove: [c.remove, c.cancel],
    confirm: [c.confirm, c.cancel],
    yesNo: [c.yes, c.no],
  }[options?.action ?? 'confirm'];
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog
        open={!!asking}
        title={options?.title ?? t.common.areYouSure}
        confirmLabel={options?.confirmLabel ?? words[0]}
        cancelLabel={options?.cancelLabel ?? words[1]}
        tone={options?.tone ?? 'danger'}
        onConfirm={() => close(true, text)}
        onCancel={cancel}
      >
        {options && (
          <>
            <div className="whitespace-pre-line">{options.message}</div>
            {shown?.kind === 'prompt' && (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') close(true, text);
                }}
                placeholder={(options as PromptOptions).placeholder}
                className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            )}
          </>
        )}
      </ConfirmDialog>
    </ConfirmContext.Provider>
  );
}
