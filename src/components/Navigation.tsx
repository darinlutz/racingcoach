'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import Brand from '@/components/Brand';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';

type NavigationProps = {
  // isAdmin shows the Admin link (the activity log); canUpgrade is false for Gold subscribers.
  // Every signed-in user sees the Coach link, and the Coach page tells anyone but Coaches and Admins it's not for them
  user: { userName: string; canUpgrade: boolean; isAdmin: boolean } | null;
  // The Admin page's Show Pricing setting (src/lib/siteSettings.ts)
  showPricing: boolean;
};

const links = [
  { href: '/#toolkit', key: 'toolkit' },
  { href: '/learning', key: 'learning' },
  { href: '/racing', key: 'coachingAnalysis' },
  { href: '/race-trends', key: 'raceTrends' },
  { href: '/pricing', key: 'pricing' },
  // Pro Driver Lessons are sold on the Pricing page for now
  { href: '/pricing', key: 'proDriverLesson' },
  { href: '/support', key: 'support' },
] as const;

export default function Navigation({ user, showPricing }: NavigationProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Hidden when the Admin page turns Show Pricing off, and for Gold subscribers, who have nothing left to buy
  const hidePricing = !showPricing || (user !== null && !user.canUpgrade);
  const visibleLinks = hidePricing ? links.filter((link) => link.key !== 'pricing') : links;

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
    // A sidebar down the left side on large screens (the layout pads the page by its width), a bar across the top with a menu below that
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border lg:fixed lg:inset-y-0 lg:left-0 lg:w-[280px] lg:border-b-0 lg:border-r lg:overflow-y-auto">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex flex-col h-full px-6 py-6 gap-10">
        <Brand />

        <div className="flex flex-col gap-5">
          {visibleLinks.map((link) => (
            <Link key={link.key} href={link.href} className={navLink(link.href)}>{t.nav[link.key]}</Link>
          ))}
        </div>

        {/* Desktop Account */}
        <div className="mt-auto flex flex-col items-start gap-5 border-t border-border pt-6">
          {user ? (
            <>
              <Link href="/coach" className={navLink('/coach')}>{t.nav.coach}</Link>
              {user.isAdmin && <Link href="/admin" className={navLink('/admin')}>{t.nav.admin}</Link>}
              <Link href="/account" className={navLink('/account')}>{t.nav.myAccount}</Link>
              <span className="font-semibold text-muted-foreground">{t.nav.driver} <span className="text-foreground">{user.userName}</span></span>
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
      </div>

      {/* Mobile Bar */}
      <div className="lg:hidden site-container h-[84px] max-sm:h-[72px] flex items-center justify-between gap-[30px] max-sm:gap-3">
        <Brand onClick={closeMenu} />

        {/* Mobile menu button */}
        <button
          onClick={toggleMenu}
          className="inline-flex items-center justify-center p-2 rounded-md hover:text-primary focus:outline-none transition-colors"
          aria-expanded={isOpen}
          aria-label={isOpen ? t.nav.closeMenu : t.nav.openMenu}
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="lg:hidden bg-card border-t border-border">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {visibleLinks.map((link) => (
              <Link key={link.key} href={link.href} className={mobileLink(link.href)} onClick={closeMenu}>{t.nav[link.key]}</Link>
            ))}
            <div className="border-t border-border pt-2 mt-2">
              {user ? (
                <>
                  <Link href="/coach" className={mobileLink('/coach')} onClick={closeMenu}>{t.nav.coach}</Link>
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
