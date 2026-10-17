'use client';

import { useMemo, useRef, useState } from 'react';
import AiUsageReport, { type LimitTarget } from '@/components/AiUsageReport';
import { useLanguage } from '@/components/LanguageProvider';
import type { AdminUser } from '@/lib/activityReport';
import {
  BURST_OPTIONS,
  EXEMPT_ROLES,
  type ExemptRoles,
  LIMIT_OPTIONS,
  LIMIT_TIERS,
  type LimitRule,
  type LimitTier,
  OVERRIDE_DURATIONS,
  OVERRIDE_MODES,
  type OverrideDuration,
  type OverrideMode,
  PERIODS,
  type Period,
  RATE_LIMITED_FEATURES,
  type RateLimitedFeature,
  type RateLimitOverride,
  type RateLimitSettings,
  RESET_STYLES,
  type ResetStyle,
  WEIGHT_OPTIONS,
} from '@/lib/rateLimitConfig';

// The Admin page's Rate Limiting section (src/lib/rateLimits.ts): turning limits on, each membership level's AI
// limit, a per-minute burst limit, the IP address cap and each feature's weight (saved together with PUT
// /api/admin/rate-limits); overrides for one user or IP address (POST/DELETE /api/admin/rate-limits/overrides);
// and the AI usage report (src/components/AiUsageReport.tsx), whose Set Limit fills in the override form.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-60';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass =
  'px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// <select> values: limits and bursts are numbers, or "unlimited"/"off" for null
const limitValue = (limit: number | null) => (limit === null ? 'unlimited' : String(limit));
const parseLimitValue = (value: string) => (value === 'unlimited' ? null : Number(value));
const durationValue = (duration: OverrideDuration) => (duration === null ? 'never' : String(duration));

type Message = { ok: boolean; text: string } | null;

export default function RateLimitManager({
  settings: initialSettings,
  overrides: initialOverrides,
  users,
  timeZone,
}: {
  settings: RateLimitSettings;
  overrides: RateLimitOverride[];
  users: AdminUser[];
  timeZone: string;
}) {
  const { t, fmt, locale } = useLanguage();
  const a = t.admin;
  const r = a.rateLimits;
  const [saved, setSaved] = useState(initialSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  const featureName = (feature: string) => a.aiFeatures[feature] ?? feature;
  const tierName = (tier: LimitTier) => r.tierNames[tier];
  const limitLabel = (limit: number | null) => (limit === null ? r.unlimited : limit === 0 ? r.noAi : limit.toLocaleString(locale));

  // Upgrading only helps when each level's limit is above the one below it
  const effective = (rule: LimitRule) => (rule.limit === null ? Infinity : rule.limit * (86400 / { hour: 3600, day: 86400, week: 604800, month: 2592000 }[rule.period]));
  const outOfOrder =
    effective(settings.tiers.Silver) < effective(settings.tiers.Bronze) || effective(settings.tiers.Gold) < effective(settings.tiers.Silver);

  const setTier = (tier: LimitTier, change: Partial<LimitRule>) =>
    setSettings((s) => ({ ...s, tiers: { ...s.tiers, [tier]: { ...s.tiers[tier], ...change } } }));

  const saveSettings = async (next: RateLimitSettings) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveSetting });
        return;
      }
      setSaved(data.settings);
      setSettings(data.settings);
      setMessage({ ok: true, text: r.saved });
    } catch {
      setMessage({ ok: false, text: t.api.failedSaveSetting });
    } finally {
      setSaving(false);
    }
  };

  // The on/off switch saves at once, with the rest of the form as it was last saved
  const toggleEnabled = () => {
    const enabled = !saved.enabled;
    setSettings((s) => ({ ...s, enabled }));
    saveSettings({ ...saved, enabled });
  };

  // ---- Overrides ----
  const [overrides, setOverrides] = useState(initialOverrides);
  const [kind, setKind] = useState<'user' | 'ip'>('user');
  const [userSearch, setUserSearch] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [ipAddress, setIpAddress] = useState('');
  const [mode, setMode] = useState<OverrideMode>('custom');
  const [limit, setLimit] = useState<number>(100);
  const [period, setPeriod] = useState<Period>('day');
  const [duration, setDuration] = useState<OverrideDuration>(null);
  const [note, setNote] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideMessage, setOverrideMessage] = useState<Message>(null);
  const overrideForm = useRef<HTMLDivElement>(null);

  const userMatches = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    const list = needle
      ? users.filter((u) => u.userName.toLowerCase().includes(needle) || u.emailAddress.toLowerCase().includes(needle))
      : users;
    const shown = list.slice(0, 50);
    // Keep the chosen user in the list while searching for someone else
    const chosen = users.find((u) => u.id === userId);
    return chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown;
  }, [userSearch, users, userId]);

  // From the usage report's Set Limit: fill in the form for that user or IP address, with its override if it has one
  const startOverride = (target: LimitTarget) => {
    const existing = overrides.find((o) => ('userId' in target ? o.userId === target.userId : o.ipAddress === target.ipAddress));
    if ('userId' in target) {
      setKind('user');
      setUserId(target.userId);
      setUserSearch('');
    } else {
      setKind('ip');
      setIpAddress(target.ipAddress);
    }
    setMode(existing?.mode ?? 'custom');
    setLimit(existing?.limit ?? 100);
    setPeriod(existing?.period ?? 'day');
    setDuration(null);
    setNote(existing?.note ?? '');
    setOverrideMessage(null);
    overrideForm.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const targetName = (o: Pick<RateLimitOverride, 'userName' | 'emailAddress' | 'ipAddress'>) =>
    o.userName ? `${o.userName} (${o.emailAddress})` : (o.ipAddress ?? '');

  const saveOverride = async () => {
    setOverrideSaving(true);
    setOverrideMessage(null);
    try {
      const res = await fetch('/api/admin/rate-limits/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(kind === 'user' ? { userId } : { ipAddress: ipAddress.trim() }),
          mode,
          limit: mode === 'custom' ? limit : null,
          period,
          note,
          durationSeconds: duration,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOverrideMessage({ ok: false, text: data.error ?? t.api.failedSaveSetting });
        return;
      }
      setOverrides(data.overrides);
      const user = users.find((u) => u.id === userId);
      setOverrideMessage({
        ok: true,
        text: fmt(r.overrideSaved, { target: kind === 'user' && user ? user.userName : ipAddress.trim() }),
      });
    } catch {
      setOverrideMessage({ ok: false, text: t.api.failedSaveSetting });
    } finally {
      setOverrideSaving(false);
    }
  };

  const removeOverride = async (id: number) => {
    setOverrideMessage(null);
    try {
      const res = await fetch(`/api/admin/rate-limits/overrides/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOverrideMessage({ ok: false, text: data.error ?? t.api.failedSaveSetting });
        return;
      }
      setOverrides(data.overrides);
      setOverrideMessage({ ok: true, text: r.overrideRemoved });
    } catch {
      setOverrideMessage({ ok: false, text: t.api.failedSaveSetting });
    }
  };

  const ruleText = (o: Pick<RateLimitOverride, 'mode' | 'limit' | 'period'>) =>
    o.mode === 'custom' ? fmt(r.ruleCustom, { limit: limitLabel(o.limit), period: r.periods[o.period] }) : r.modes[o.mode];
  const formatTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const canSaveOverride = (kind === 'user' ? userId !== null : ipAddress.trim() !== '') && !overrideSaving;

  const limitSelect = (id: string, value: number | null, onChange: (limit: number | null) => void, options = LIMIT_OPTIONS) => (
    <select id={id} value={limitValue(value)} onChange={(e) => onChange(parseLimitValue(e.target.value))} disabled={saving} className={inputClass}>
      {options.map((option) => (
        <option key={limitValue(option)} value={limitValue(option)}>
          {limitLabel(option)}
        </option>
      ))}
    </select>
  );
  const periodSelect = (id: string, value: Period, onChange: (period: Period) => void, disabled = saving) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Period)} disabled={disabled} className={inputClass}>
      {PERIODS.map((p) => (
        <option key={p} value={p}>
          {r.periodOptions[p]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">{r.title}</h2>
        <p className="text-sm text-muted-foreground">{r.intro}</p>
      </div>

      {/* The master switch */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{r.enforce}</p>
          <p className="text-xs text-muted-foreground">{saved.enabled ? r.enforceOn : r.enforceOff}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={saved.enabled}
          aria-label={r.enforce}
          onClick={toggleEnabled}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            saved.enabled ? 'bg-primary' : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${saved.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rl-reset-style" className={labelClass}>{r.resetStyle}</label>
          <select
            id="rl-reset-style"
            value={settings.resetStyle}
            onChange={(e) => setSettings((s) => ({ ...s, resetStyle: e.target.value as ResetStyle }))}
            disabled={saving}
            className={inputClass}
          >
            {RESET_STYLES.map((style) => (
              <option key={style} value={style}>{r.resetStyles[style]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rl-exempt" className={labelClass}>{r.exemptRoles}</label>
          <select
            id="rl-exempt"
            value={settings.exemptRoles}
            onChange={(e) => setSettings((s) => ({ ...s, exemptRoles: e.target.value as ExemptRoles }))}
            disabled={saving}
            className={inputClass}
          >
            {EXEMPT_ROLES.map((value) => (
              <option key={value} value={value}>{r.exemptRoleOptions[value]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Each membership level's limit */}
      <div>
        <h3 className="text-sm font-semibold text-foreground">{r.tiersTitle}</h3>
        <p className="text-xs text-muted-foreground mb-3">{r.tiersHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{r.level}</th>
                <th className="py-1 pr-3 font-medium">{r.limit}</th>
                <th className="py-1 pr-3 font-medium">{r.per}</th>
                <th className="py-1 font-medium">{r.burst}</th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_TIERS.map((tier) => (
                <tr key={tier}>
                  <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">{tierName(tier)}</td>
                  <td className="py-1.5 pr-3 min-w-[130px]">
                    {limitSelect(`rl-limit-${tier}`, settings.tiers[tier].limit, (value) => setTier(tier, { limit: value }))}
                  </td>
                  <td className="py-1.5 pr-3 min-w-[130px]">
                    {periodSelect(`rl-period-${tier}`, settings.tiers[tier].period, (value) => setTier(tier, { period: value }))}
                  </td>
                  <td className="py-1.5 min-w-[110px]">
                    <select
                      id={`rl-burst-${tier}`}
                      aria-label={`${r.burst}: ${tierName(tier)}`}
                      value={settings.burst[tier] === null ? 'off' : String(settings.burst[tier])}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, burst: { ...s.burst, [tier]: e.target.value === 'off' ? null : Number(e.target.value) } }))
                      }
                      disabled={saving}
                      className={inputClass}
                    >
                      {BURST_OPTIONS.map((option) => (
                        <option key={option ?? 'off'} value={option === null ? 'off' : String(option)}>
                          {option === null ? r.burstOff : option}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {outOfOrder && <p className="mt-2 text-xs text-amber-400">{r.orderWarning}</p>}
      </div>

      {/* Everyone at one IP address */}
      <div>
        <h3 className="text-sm font-semibold text-foreground">{r.ipTitle}</h3>
        <p className="text-xs text-muted-foreground mb-3">{r.ipHint}</p>
        <div className="grid gap-4 sm:grid-cols-2 max-w-md">
          <div>
            <label htmlFor="rl-ip-limit" className={labelClass}>{r.limit}</label>
            {limitSelect('rl-ip-limit', settings.ip.limit, (value) => setSettings((s) => ({ ...s, ip: { ...s.ip, limit: value } })))}
          </div>
          <div>
            <label htmlFor="rl-ip-period" className={labelClass}>{r.per}</label>
            {periodSelect('rl-ip-period', settings.ip.period, (value) => setSettings((s) => ({ ...s, ip: { ...s.ip, period: value } })))}
          </div>
        </div>
      </div>

      {/* What each feature counts */}
      <div>
        <h3 className="text-sm font-semibold text-foreground">{r.weightsTitle}</h3>
        <p className="text-xs text-muted-foreground mb-3">{r.weightsHint}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RATE_LIMITED_FEATURES.map((feature: RateLimitedFeature) => (
            <div key={feature}>
              <label htmlFor={`rl-weight-${feature}`} className={labelClass}>{featureName(feature)}</label>
              <select
                id={`rl-weight-${feature}`}
                value={settings.weights[feature]}
                onChange={(e) => setSettings((s) => ({ ...s, weights: { ...s.weights, [feature]: Number(e.target.value) } }))}
                disabled={saving}
                className={inputClass}
              >
                {WEIGHT_OPTIONS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight === 0 ? r.weightOff : fmt(r.weightCalls, { n: weight })}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => saveSettings(settings)} disabled={saving || !dirty} className={buttonClass}>
          {saving ? r.saving : r.save}
        </button>
        {dirty && !saving && <span className="text-xs text-amber-400">{r.unsaved}</span>}
      </div>
      {message && <StatusMessage message={message} />}

      {/* Overrides for one user or IP address */}
      <div ref={overrideForm} className="pt-4 border-t border-border">
        <h3 className="text-lg font-bold text-foreground mb-1">{r.overridesTitle}</h3>
        <p className="text-sm text-muted-foreground mb-4">{r.overridesIntro}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="rl-kind" className={labelClass}>{r.appliesTo}</label>
            <select id="rl-kind" value={kind} onChange={(e) => setKind(e.target.value as 'user' | 'ip')} className={inputClass}>
              <option value="user">{r.appliesUser}</option>
              <option value="ip">{r.appliesIp}</option>
            </select>
          </div>
          {kind === 'user' ? (
            <>
              <div>
                <label htmlFor="rl-user-search" className={labelClass}>{r.findUser}</label>
                <input
                  id="rl-user-search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder={r.findUserPlaceholder}
                  className={inputClass}
                />
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="rl-user" className={labelClass}>{a.user}</label>
                <select
                  id="rl-user"
                  value={userId ?? ''}
                  onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
                  className={inputClass}
                >
                  <option value="">{r.chooseUser}</option>
                  {userMatches.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.userName} ({u.emailAddress}) · {t.pricing.levelNames[u.membershipLevel] ?? u.membershipLevel}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="lg:col-span-3">
              <label htmlFor="rl-ip" className={labelClass}>{r.ipAddress}</label>
              <input id="rl-ip" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder={r.ipPlaceholder} className={inputClass} />
            </div>
          )}

          <div>
            <label htmlFor="rl-mode" className={labelClass}>{r.rule}</label>
            <select id="rl-mode" value={mode} onChange={(e) => setMode(e.target.value as OverrideMode)} className={inputClass}>
              {OVERRIDE_MODES.map((value) => (
                <option key={value} value={value}>{r.modes[value]}</option>
              ))}
            </select>
          </div>
          {mode === 'custom' && (
            <>
              <div>
                <label htmlFor="rl-override-limit" className={labelClass}>{r.limit}</label>
                <select id="rl-override-limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputClass}>
                  {LIMIT_OPTIONS.filter((option): option is number => option !== null).map((option) => (
                    <option key={option} value={option}>{limitLabel(option)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rl-override-period" className={labelClass}>{r.per}</label>
                {periodSelect('rl-override-period', period, setPeriod, false)}
              </div>
            </>
          )}
          <div>
            <label htmlFor="rl-duration" className={labelClass}>{r.lasts}</label>
            <select
              id="rl-duration"
              value={durationValue(duration)}
              onChange={(e) => setDuration(e.target.value === 'never' ? null : (Number(e.target.value) as OverrideDuration))}
              className={inputClass}
            >
              {OVERRIDE_DURATIONS.map((value) => (
                <option key={durationValue(value)} value={durationValue(value)}>{r.durations[durationValue(value)]}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label htmlFor="rl-note" className={labelClass}>{r.note}</label>
            <input id="rl-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={r.notePlaceholder} className={inputClass} />
          </div>
        </div>

        <div className="mt-4">
          <button type="button" onClick={saveOverride} disabled={!canSaveOverride} className={buttonClass}>
            {overrideSaving ? r.saving : r.saveOverride}
          </button>
        </div>
        {overrideMessage && <StatusMessage message={overrideMessage} />}

        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs text-muted-foreground">
              <tr>
                {[r.who, r.rule, r.expires, r.note, r.setBy, ''].map((heading, i) => (
                  <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overrides.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{r.noOverrides}</td>
                </tr>
              )}
              {overrides.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-3 py-2 text-foreground">{targetName(o)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={o.mode === 'blocked' ? 'text-red-400' : o.mode === 'unlimited' ? 'text-green-400' : 'text-foreground'}>
                      {ruleText(o)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {o.expiresAt ? formatTime.format(new Date(o.expiresAt)) : r.never}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate" title={o.note}>{o.note || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{o.createdBy ?? '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => startOverride(o.userId !== null ? { userId: o.userId } : { ipAddress: o.ipAddress ?? '' })}
                      className="text-xs text-primary hover:underline mr-3"
                    >
                      {r.edit}
                    </button>
                    <button type="button" onClick={() => removeOverride(o.id)} className="text-xs text-red-400 hover:underline">
                      {r.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AiUsageReport timeZone={timeZone} onSetLimit={startOverride} overridesVersion={overrides} />
    </div>
  );
}

function StatusMessage({ message }: { message: { ok: boolean; text: string } }) {
  return (
    <p
      role="status"
      className={`mt-3 p-3 rounded-lg text-sm ${message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'}`}
    >
      {message.text}
    </p>
  );
}
