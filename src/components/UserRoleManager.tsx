'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { MEMBERSHIP_LEVEL, MEMBERSHIP_LEVEL_VALUES, type MembershipLevel } from '@/lib/accountStatus';
import type { AdminUser } from '@/lib/activityReport';
import { ROLE_VALUES, type Role } from '@/lib/roles';

// The Admin page's User Roles section: search for an account, pick it, choose Admin, Coach or User and
// Bronze, Silver or Gold, and save (PUT /api/admin/users/role, which gets only what changed). The
// signed-in admin can't change their own role, but can change their own membership level.

const MAX_MATCHES = 8;

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default function UserRoleManager({ users: initialUsers, currentUserId }: { users: AdminUser[]; currentUserId: number }) {
  const { t, fmt } = useLanguage();
  const a = t.admin;
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [role, setRole] = useState<Role>('User');
  const [level, setLevel] = useState<MembershipLevel>(MEMBERSHIP_LEVEL.bronze);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return users.filter((u) => u.userName.toLowerCase().includes(needle) || u.emailAddress.toLowerCase().includes(needle));
  }, [search, users]);

  const selected = users.find((u) => u.id === selectedId) ?? null;
  const isSelf = selected?.id === currentUserId;
  const roleName = (value: string) => a.roles[value] ?? value;
  const levelName = (value: string) => t.pricing.levelNames[value] ?? value;
  const roleChanged = !!selected && !isSelf && role !== selected.role;
  const levelChanged = !!selected && level !== selected.membershipLevel;

  const select = (user: AdminUser) => {
    setSelectedId(user.id);
    setRole(ROLE_VALUES.find((value) => value === user.role) ?? 'User');
    setLevel(MEMBERSHIP_LEVEL_VALUES.find((value) => value === user.membershipLevel) ?? MEMBERSHIP_LEVEL.bronze);
    setMessage(null);
  };

  const save = async () => {
    if (!selected || (!roleChanged && !levelChanged)) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/users/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selected.id,
          role: roleChanged ? role : undefined,
          membershipLevel: levelChanged ? level : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? t.api.failedSaveRole });
        return;
      }
      const saved = { ...selected, role: data.role ?? selected.role, membershipLevel: data.membershipLevel ?? selected.membershipLevel };
      setUsers((list) => list.map((u) => (u.id === selected.id ? saved : u)));
      setMessage({
        ok: true,
        text: fmt(a.userSaved, { user: saved.userName, role: roleName(saved.role), level: levelName(saved.membershipLevel) }),
      });
      // The activity log's "include admin activity" filter depends on roles
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.api.failedSaveRole });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-xl font-bold text-foreground mb-1">{a.rolesTitle}</h2>
      <p className="text-sm text-muted-foreground mb-4">{a.rolesIntro}</p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Find and pick a user */}
        <div>
          <label htmlFor="role-user-search" className="block text-xs font-medium text-muted-foreground mb-1">
            {a.findUser}
          </label>
          <input
            id="role-user-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={a.findPlaceholder}
            autoComplete="off"
            className={inputClass}
          />
          {search.trim() && (
            <div className="mt-2">
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1">{a.noMatches}</p>
              ) : (
                <ul className="bg-card border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {matches.slice(0, MAX_MATCHES).map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => select(u)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                          u.id === selectedId ? 'bg-primary/15' : 'hover:bg-secondary'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm text-foreground truncate">
                            {u.userName} {u.id === currentUserId && <span className="text-muted-foreground">{a.you}</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">{u.emailAddress}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground text-right">
                          {roleName(u.role)}
                          <span className="block">{levelName(u.membershipLevel)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {matches.length > MAX_MATCHES && (
                <p className="mt-1 text-xs text-muted-foreground px-1">{fmt(a.keepTyping, { n: MAX_MATCHES })}</p>
              )}
            </div>
          )}
        </div>

        {/* Change the selected user's role and membership level */}
        <div>
          {selected ? (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div>
                <p className="text-foreground font-medium">
                  {selected.userName} {isSelf && <span className="text-muted-foreground">{a.you}</span>}
                </p>
                <p className="text-sm text-muted-foreground break-all">{selected.emailAddress}</p>
              </div>
              <div>
                <label htmlFor="role-select" className="block text-xs font-medium text-muted-foreground mb-1">
                  {a.role}
                </label>
                <select
                  id="role-select"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as Role);
                    setMessage(null);
                  }}
                  disabled={isSelf || saving}
                  className={`${inputClass} disabled:opacity-60`}
                >
                  {ROLE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {roleName(value)}
                    </option>
                  ))}
                </select>
                {isSelf && <p className="mt-1 text-sm text-muted-foreground">{a.ownRole}</p>}
              </div>
              <div>
                <label htmlFor="membership-level-select" className="block text-xs font-medium text-muted-foreground mb-1">
                  {a.membershipLevel}
                </label>
                <select
                  id="membership-level-select"
                  value={level}
                  onChange={(e) => {
                    setLevel(e.target.value as MembershipLevel);
                    setMessage(null);
                  }}
                  disabled={saving}
                  className={`${inputClass} disabled:opacity-60`}
                >
                  {MEMBERSHIP_LEVEL_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {levelName(value)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={save}
                disabled={saving || (!roleChanged && !levelChanged)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? a.savingRole : a.saveRole}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground md:pt-6">{a.selectUser}</p>
          )}
          {message && (
            <p
              role="status"
              className={`mt-3 p-3 rounded-lg text-sm ${
                message.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
