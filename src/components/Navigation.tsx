'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import Brand from '@/components/Brand';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';

type NavigationProps = {
  // isAdmin shows the Admin link (the activity log); canUpgrade is false for Gold subscribers
  user: { userName: string; canUpgrade: boolean; isAdmin: boolean } | null;
};

const links = [
  { href: '/#toolkit', key: 'toolkit' },
  { href: '/#how-it-works', key: 'howItWorks' },
  { href: '/racing', key: 'coachingAnalysis' },
  { href: '/race-trends', key: 'raceTrends' },
  { href: '/pricing', key: 'pricing' },
] as const;

export default function Navigation({ user }: NavigationProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Gold subscribers have nothing left to buy
  const visibleLinks = user && !user.canUpgrade ? links.filter((link) => link.href !== '/pricing') : links;

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setLoggingOut(false);
      closeMenu();
      router.push('/');
      router.refresh();
    }
  };

  // Same type treatment as the Coaching & Analysis tabs: semibold, muted, red when current
  const linkColor = (href: string) => (href === pathname ? 'text-primary' : 'text-muted-foreground hover:text-foreground');
  const navLink = (href: string) => `font-semibold whitespace-nowrap transition-colors ${linkColor(href)}`;
  const mobileLink = (href: string) => `block px-3 py-2 rounded-md font-semibold hover:bg-secondary transition-colors ${linkColor(href)}`;

  return (
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border">
      <div className="site-container h-[84px] max-sm:h-[72px] flex items-center justify-between gap-[30px] max-sm:gap-3">
        <Brand onClick={closeMenu} />

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          {visibleLinks.map((link) => (
            <Link key={link.href} href={link.href} className={navLink(link.href)}>{t.nav[link.key]}</Link>
          ))}
        </div>

        {/* Desktop Account */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <>
              {user.isAdmin && <Link href="/admin" className={navLink('/admin')}>{t.nav.admin}</Link>}
              <Link href="/account" className={navLink('/account')}>{t.nav.myAccount}</Link>
              <span className="font-semibold text-muted-foreground whitespace-nowrap">{t.nav.driver} <span className="text-foreground">{user.userName}</span></span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className={buttonVariants({ variant: 'racingOutline', size: 'sm', className: 'disabled:opacity-60' })}
              >
                {t.nav.logout}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={navLink('/login')}>{t.nav.logIn}</Link>
              <Link href="/signup" className={buttonVariants({ variant: 'racing', size: 'sm' })}>
                {t.nav.getStarted} <ArrowRight />
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={toggleMenu}
          className="md:hidden inline-flex items-center justify-center p-2 rounded-md hover:text-primary focus:outline-none transition-colors"
          aria-expanded={isOpen}
          aria-label={isOpen ? t.nav.closeMenu : t.nav.openMenu}
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="md:hidden bg-card border-t border-border">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {visibleLinks.map((link) => (
              <Link key={link.href} href={link.href} className={mobileLink(link.href)} onClick={closeMenu}>{t.nav[link.key]}</Link>
            ))}
            <div className="border-t border-border pt-2 mt-2">
              {user ? (
                <>
                  {user.isAdmin && (
                    <Link href="/admin" className={mobileLink('/admin')} onClick={closeMenu}>{t.nav.admin}</Link>
                  )}
                  <Link href="/account" className={mobileLink('/account')} onClick={closeMenu}>{t.nav.myAccount}</Link>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className={buttonVariants({ variant: 'racingOutline', size: 'sm', className: 'disabled:opacity-60' })}
                    >
                      {t.nav.logout}
                    </button>
                    <span className="font-semibold text-muted-foreground">{t.nav.driver} <span className="text-foreground">{user.userName}</span></span>
                  </div>
                </>
              ) : (
                <>
                  <Link href="/login" className={mobileLink('/login')} onClick={closeMenu}>{t.nav.logIn}</Link>
                  <Link href="/signup" className={mobileLink('/signup')} onClick={closeMenu}>{t.nav.getStarted}</Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
