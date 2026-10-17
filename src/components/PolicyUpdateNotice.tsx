'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileText } from 'lucide-react';
import Button from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import { POLICY_VERSIONS } from '@/lib/policyVersions';

// Shown above every page to a signed-in user who hasn't accepted the current Terms of Service and Privacy Policy
// (src/lib/policyAcceptances.ts): an account from before the policies, or one that accepted an earlier version.
// The box starts unchecked; Accept records the versions shown (POST /api/account/policy-acceptance) and the notice
// goes away. It doesn't block the page, so the documents can be read first. The collector's window points here too
// when the account hasn't accepted them (GET /api/collector/me's policiesAccepted).
export default function PolicyUpdateNotice() {
  const { t } = useLanguage();
  const p = t.policyUpdate;
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  if (accepted) return null;

  // {terms} and {privacy} as links to the documents, opened beside the page
  const withLinks = (text: string) =>
    text.split(/(\{terms\}|\{privacy\})/).map((part, i) =>
      part === '{terms}' ? (
        <Link key={i} href="/terms" target="_blank" className="text-primary hover:underline">{t.legal.termsTitle}</Link>
      ) : part === '{privacy}' ? (
        <Link key={i} href="/privacy" target="_blank" className="text-primary hover:underline">{t.legal.privacyTitle}</Link>
      ) : (
        part
      ),
    );

  const accept = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/account/policy-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptedPolicies: POLICY_VERSIONS }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || t.api.failedSavePolicies);
        return;
      }
      setAccepted(true);
    } catch {
      setError(t.api.failedSavePolicies);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section role="region" aria-labelledby="policy-update-title" className="border-b border-border bg-card">
      <div className="site-container py-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <div className="flex-1 min-w-0">
          <h2 id="policy-update-title" className="flex items-center gap-2 font-semibold">
            <FileText className="w-4 h-4 text-primary shrink-0" aria-hidden />
            {p.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{withLinks(p.body)}</p>
          <label className="mt-2 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>{withLinks(p.checkbox)}</span>
          </label>
          {error && <p role="alert" className="mt-2 text-sm text-primary">{error}</p>}
        </div>
        <Button variant="racing" size="sm" onClick={accept} disabled={!checked || saving} className="self-start md:self-center">
          {saving ? p.saving : p.accept}
        </Button>
      </div>
    </section>
  );
}
