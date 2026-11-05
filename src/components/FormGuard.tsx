'use client';

import { useEffect, useRef } from 'react';

// The browser half of checkFormGuard (src/lib/abuseGuards.ts): a text box people never see or reach with the
// keyboard, which form-filling bots fill in, and how long the form was on screen before it was sent. Put
// <FormGuardField inputRef={...} /> in the form and spread guardFields() into the request body.
export function useFormGuard() {
  const shownAt = useRef<number | null>(null);
  const trap = useRef<HTMLInputElement>(null);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);
  const guardFields = () => ({
    formTrap: trap.current?.value ?? '',
    formMs: shownAt.current === null ? 0 : Date.now() - shownAt.current,
  });
  return { trap, guardFields };
}

export function FormGuardField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div aria-hidden="true" data-no-track className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label>
        Leave this empty
        <input ref={inputRef} type="text" name="contact_reference" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}
