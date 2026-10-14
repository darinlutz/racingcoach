'use client';

import { useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';

// The Support page's form: name and email (pre-filled for signed-in users), the issue, and Send Report
// (POST /api/support), which emails it to the site owner.
export default function SupportForm({ name: initialName, email: initialEmail, maxLength }: { name: string; email: string; maxLength: number }) {
  const { t, fmt } = useLanguage();
  const s = t.support;
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? s.failed });
        return;
      }
      setDescription('');
      setMessage({ ok: true, text: fmt(s.sent, { email: email.trim() }) });
    } catch {
      setMessage({ ok: false, text: s.failed });
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

  return (
    <form onSubmit={send} className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <p className="text-sm text-muted-foreground">{s.intro}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="support-name" className="block text-sm font-semibold text-foreground mb-1">
            {t.common.name}
          </label>
          <input id="support-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="support-email" className="block text-sm font-semibold text-foreground mb-1">
            {t.common.emailAddress}
          </label>
          <input id="support-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} required className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="support-description" className="block text-sm font-semibold text-foreground mb-1">
          {s.description}
        </label>
        <textarea
          id="support-description"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setMessage(null);
          }}
          maxLength={maxLength}
          rows={10}
          required
          placeholder={s.placeholder}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={sending || !description.trim()}
        className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? s.sending : s.send}
      </button>

      {message && (
        <p
          role="status"
          className={`p-3 rounded-lg text-sm ${
            message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
