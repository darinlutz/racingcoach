'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// Whether this sign-in has confirmed it's the account holder (src/lib/reauth.ts), shared by Privacy & Data Rights'
// sections so one confirmation covers them all. The server checks it again on every request; this only decides
// whether to show ReauthForm first.
type PrivacyReauthValue = {
  confirmed: boolean;
  hasPassword: boolean;
  setConfirmed: (confirmed: boolean) => void;
};

const PrivacyReauthContext = createContext<PrivacyReauthValue | null>(null);

export function usePrivacyReauth(): PrivacyReauthValue {
  const value = useContext(PrivacyReauthContext);
  if (!value) throw new Error('usePrivacyReauth must be used inside PrivacyReauthProvider');
  return value;
}

export default function PrivacyReauthProvider({
  initialConfirmed,
  hasPassword,
  children,
}: {
  initialConfirmed: boolean;
  hasPassword: boolean;
  children: ReactNode;
}) {
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const value = useMemo(() => ({ confirmed, hasPassword, setConfirmed }), [confirmed, hasPassword]);
  return <PrivacyReauthContext.Provider value={value}>{children}</PrivacyReauthContext.Provider>;
}
