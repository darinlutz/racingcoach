'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { useLanguage } from '@/components/LanguageProvider';
import { countryFlagClass, countryName, countryOptions, countrySearchText } from '@/lib/countryCodes';
import { LANGUAGE_LOCALES } from '@/lib/i18n/languages';

function FlagOf({ code }: { code: string | null }) {
  return code ? (
    <span className={`${countryFlagClass(code)} shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.15)]`} aria-hidden />
  ) : (
    <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}

// The Country box (sign-up form, and User Preferences on the Account page): every country with its flag, which a
// <select> can't show, with Not Specified (null) first, and a search box. What's picked isn't recorded in the Activity
// Log (data-no-track). The page must import flag-icons' CSS.
export default function CountrySelect({
  id,
  value,
  onChange,
  disabled = false,
  className,
}: {
  id: string;
  value: string | null;
  onChange: (country: string | null) => void;
  disabled?: boolean;
  className: string;
}) {
  const { t, language } = useLanguage();
  const p = t.preferences;
  const locale = LANGUAGE_LOCALES[language];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Only worked out once it's opened
  const countries = useMemo(() => (open ? countryOptions(locale) : []), [open, locale]);
  const options = useMemo(() => {
    const wanted = countrySearchText(search);
    const all: { code: string | null; name: string }[] = [{ code: null, name: p.notSpecified }, ...countries];
    return wanted ? all.filter((option) => countrySearchText(option.name).includes(wanted)) : all;
  }, [countries, search, p.notSpecified]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setSearch('');
    setActive(value ? countryOptions(locale).findIndex((option) => option.code === value) + 1 : 0);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const pick = (code: string | null) => {
    close();
    if (code !== value) onChange(code);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      // Not the sign-up form's submit
      e.preventDefault();
      if (options[active]) pick(options[active].code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-no-track>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className={`${className} flex items-center gap-3 text-left disabled:opacity-60`}
      >
        <FlagOf code={value} />
        {/* The server's and the browser's Intl can word a country differently; the browser's is what's opened anyway */}
        <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
          {value ? countryName(value, locale) : p.notSpecified}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          <input
            type="text"
            role="combobox"
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={p.searchCountries}
            aria-label={p.searchCountries}
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={options[active] ? `${id}-option-${options[active].code ?? 'none'}` : undefined}
            autoComplete="off"
            className="w-full border-b border-border bg-transparent px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none"
          />
          <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label={p.country} className="max-h-64 overflow-y-auto py-1">
            {options.map((option, i) => (
              <li
                key={option.code ?? 'none'}
                id={`${id}-option-${option.code ?? 'none'}`}
                role="option"
                aria-selected={option.code === value}
                onClick={() => pick(option.code)}
                onPointerMove={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-foreground ${i === active ? 'bg-secondary' : ''} ${option.code === value ? 'font-semibold' : ''}`}
              >
                <FlagOf code={option.code} />
                <span className="min-w-0 truncate">{option.name}</span>
              </li>
            ))}
            {options.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">{p.noCountries}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
