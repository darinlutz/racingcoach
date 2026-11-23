'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '@/components/ConfirmProvider';
import { useLanguage } from '@/components/LanguageProvider';
import {
  ELEVENLABS_VOICE_LANGUAGES,
  ELEVENLABS_VOICE_ROLES,
  elevenLabsVoiceLabel,
  VOICE_LIMITS,
  type ElevenLabsVoiceLanguage,
  type ElevenLabsVoiceRole,
} from '@/lib/elevenLabsVoiceRules';
import type { ElevenLabsVoice } from '@/lib/elevenLabsVoices';

// The Admin page's Eleven Labs Voice Management (src/lib/elevenLabsVoices.ts): every ElevenLabs voice (its name for
// the Admin, Voice ID, role and language, whether it's enabled, and the name drivers see for it), with Add, Edit and
// Delete. GET/POST /api/admin/elevenlabs-voices, PUT/DELETE /api/admin/elevenlabs-voices/[id], Admins only.

type Form = { id: number | null; name: string; voiceId: string; role: ElevenLabsVoiceRole; language: ElevenLabsVoiceLanguage; enabled: boolean; notes: string };
const EMPTY: Form = { id: null, name: '', voiceId: '', role: 'raceCoach', language: 'en', enabled: true, notes: '' };

// The list's language radio buttons: every language but the owner's Driver Radio voice's 'all', which is listed first
// whichever is picked
const LIST_LANGUAGES = ELEVENLABS_VOICE_LANGUAGES.filter((l) => l !== 'all');
type ListLanguage = (typeof LIST_LANGUAGES)[number];

// The owner's Driver Radio voice first, then the roles in their order, then by name
function listOrder(a: ElevenLabsVoice, b: ElevenLabsVoice): number {
  const rank = (v: ElevenLabsVoice) => (v.role === 'ownerRadio' ? -1 : ELEVENLABS_VOICE_ROLES.indexOf(v.role));
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1';
const buttonClass = 'rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-50';
const primaryClass = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';

export default function ElevenLabsVoiceManager() {
  const { t, fmt } = useLanguage();
  const ask = useConfirm();
  const s = t.admin.elevenLabsVoices;
  const [voices, setVoices] = useState<ElevenLabsVoice[] | null>(null);
  const [apiKeySet, setApiKeySet] = useState(true);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listLanguage, setListLanguage] = useState<ListLanguage>('en');
  const shown = (voices ?? []).filter((v) => v.role === 'ownerRadio' || v.language === listLanguage).sort(listOrder);
  // A new voice starts in the language being looked at
  const blank = (): Form => ({ ...EMPTY, language: listLanguage });
  const pickLanguage = (language: ListLanguage) => {
    setListLanguage(language);
    if (!form.id && form.role !== 'ownerRadio') setForm({ ...form, language });
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/elevenlabs-voices');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVoices(data.voices);
      setApiKeySet(data.apiKeySet);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.errors.failed);
    }
  }, [s.errors.failed]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once
    void load();
  }, [load]);

  const clear = () => {
    setError('');
    setProblems([]);
    setMessage('');
  };

  const save = async () => {
    clear();
    setBusy(true);
    try {
      const { id, ...body } = form;
      const res = await fetch(id ? `/api/admin/elevenlabs-voices/${id}` : '/api/admin/elevenlabs-voices', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || s.errors.failed);
        setProblems(Array.isArray(data.problems) ? data.problems : []);
        return;
      }
      setForm(blank());
      await load();
      setMessage(s.saved);
    } catch {
      setError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (voice: ElevenLabsVoice) => {
    if (!(await ask.confirm({ message: fmt(s.confirmDelete, { name: voice.name }), action: 'delete' }))) return;
    clear();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/elevenlabs-voices/${voice.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || s.errors.failed);
      else setMessage(fmt(s.deleted, { name: voice.name }));
      if (form.id === voice.id) setForm(blank());
      await load();
    } catch {
      setError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  const edit = (voice: ElevenLabsVoice) => {
    clear();
    setForm({ id: voice.id, name: voice.name, voiceId: voice.voiceId, role: voice.role, language: voice.language, enabled: voice.enabled, notes: voice.notes });
  };

  // What drivers see for a voice, in this Admin's own language
  const shownAs = (voice: Pick<ElevenLabsVoice, 'role' | 'language'>) =>
    voice.role === 'ownerRadio' ? s.roles.ownerRadio : elevenLabsVoiceLabel(t.inCarCoach, voice.language, voice.role);
  const languages = form.role === 'ownerRadio' ? (['all'] as const) : ELEVENLABS_VOICE_LANGUAGES.filter((l) => l !== 'all');

  return (
    <div id="elevenlabs-voices" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{s.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{s.intro}</p>
      </div>
      {!apiKeySet && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">{s.apiKeyMissing}</p>}
      {error && (
        <div className="text-sm text-red-500" role="alert">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && <p className="text-sm text-good-text">{message}</p>}

      <section className="rounded-lg border border-border p-4 space-y-4">
        <h3 className="font-semibold text-foreground">{form.id ? s.editTitle : s.addTitle}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="elv-name" className={labelClass}>
              {s.name}
            </label>
            <input id="elv-name" value={form.name} maxLength={VOICE_LIMITS.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            <p className="mt-1 text-xs text-muted-foreground">{s.nameHelp}</p>
          </div>
          <div>
            <label htmlFor="elv-id" className={labelClass}>
              {s.voiceId}
            </label>
            <input
              id="elv-id"
              value={form.voiceId}
              onChange={(e) => setForm({ ...form, voiceId: e.target.value.trim() })}
              spellCheck={false}
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-xs text-muted-foreground">{s.voiceIdHelp}</p>
          </div>
          <div>
            <label htmlFor="elv-role" className={labelClass}>
              {s.role}
            </label>
            <select
              id="elv-role"
              value={form.role}
              onChange={(e) => {
                const role = e.target.value as ElevenLabsVoiceRole;
                setForm({ ...form, role, language: role === 'ownerRadio' ? 'all' : form.language === 'all' ? 'en' : form.language });
              }}
              className={inputClass}
            >
              {ELEVENLABS_VOICE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {s.roles[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="elv-language" className={labelClass}>
              {s.language}
            </label>
            <select
              id="elv-language"
              value={form.language}
              disabled={form.role === 'ownerRadio'}
              onChange={(e) => setForm({ ...form, language: e.target.value as ElevenLabsVoiceLanguage })}
              className={inputClass}
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {s.languages[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="elv-notes" className={labelClass}>
              {s.notes}
            </label>
            <textarea id="elv-notes" value={form.notes} maxLength={VOICE_LIMITS.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              {s.enabled}
            </label>
            <p className="text-xs text-muted-foreground">{s.enabledHelp}</p>
            <p className="text-xs text-muted-foreground">
              {s.shownAs}: <span className="font-semibold text-foreground">{shownAs(form)}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !form.name.trim() || !form.voiceId} onClick={() => void save()} className={primaryClass}>
            {busy ? s.saving : form.id ? s.save : s.add}
          </button>
          {form.id && (
            <button type="button" disabled={busy} onClick={() => setForm(blank())} className={buttonClass}>
              {s.cancel}
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">{s.voices}</h3>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <legend className={`${labelClass} mb-2`}>{s.showLanguage}</legend>
          {LIST_LANGUAGES.map((l) => (
            <label key={l} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
              <input type="radio" name="elv-list-language" value={l} checked={listLanguage === l} onChange={() => pickLanguage(l)} className="accent-primary" />
              {s.languages[l]}
            </label>
          ))}
        </fieldset>
        {!voices ? (
          <p className="text-sm text-muted-foreground">{s.loading}</p>
        ) : voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.none}</p>
        ) : (
          <>
            {!shown.some((v) => v.language === listLanguage) && (
              <p className="text-sm text-muted-foreground">{fmt(s.noneForLanguage, { language: s.languages[listLanguage] })}</p>
            )}
            {shown.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm text-foreground">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">{s.name}</th>
                  <th className="px-3 py-2">{s.role}</th>
                  <th className="px-3 py-2">{s.language}</th>
                  <th className="px-3 py-2">{s.voiceId}</th>
                  <th className="px-3 py-2">{s.shownAs}</th>
                  <th className="px-3 py-2">{s.status}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((voice) => (
                  <tr key={voice.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{voice.name}</div>
                      {voice.elevenLabsName && <div className="text-xs text-muted-foreground">{fmt(s.elevenLabsName, { name: voice.elevenLabsName })}</div>}
                      {voice.notes && <div className="text-xs text-muted-foreground">{voice.notes}</div>}
                    </td>
                    <td className="px-3 py-2">{s.roles[voice.role]}</td>
                    <td className="px-3 py-2">{s.languages[voice.language]}</td>
                    <td className="px-3 py-2 font-mono text-xs">{voice.voiceId}</td>
                    <td className="px-3 py-2">{shownAs(voice)}</td>
                    <td className="px-3 py-2">{voice.enabled ? s.enabledStatus : s.disabledStatus}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} className={buttonClass} onClick={() => edit(voice)}>
                          {s.edit}
                        </button>
                        <button type="button" disabled={busy} className={`${buttonClass} text-red-500 hover:border-red-500`} onClick={() => void remove(voice)}>
                          {s.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
