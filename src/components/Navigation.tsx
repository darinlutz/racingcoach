'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState, type FocusEvent, type MouseEvent } from 'react';
import {
  ArrowRight, BookOpen, Car, ChartLine, ChevronsLeft, ClipboardList, Download, Flag, GraduationCap, LifeBuoy, LogIn,
  LogOut, Menu, Settings, ShieldCheck, Tag, Timer, TrendingUp, UserPlus, Wrench, X, type LucideIcon,
} from 'lucide-react';
import Brand from '@/components/Brand';
import { buttonVariants } from '@/components/Button';
import { useLanguage } from '@/components/LanguageProvider';
import LoginRequiredDialog from '@/components/LoginRequiredDialog';
import { NAV_COLLAPSED, NAV_COOKIE } from '@/lib/navSidebar';

type NavigationProps = {
  // isAdmin shows the Admin and My Race Trends links; canUpgrade is false for Gold subscribers.
  // canCoach (Coaches and Admins) shows the Coach link
  user: { userName: string; canUpgrade: boolean; isAdmin: boolean; canCoach: boolean } | null;
  // The Admin page's Show Pricing setting (src/lib/siteSettings.ts)
  showPricing: boolean;
  // The Admin page's Show Pro Driver Lesson setting
  showProDriverLesson: boolean;
  // The Admin page's Enable AI Features setting, which picks the logo's tagline
  enableAiFeatures: boolean;
  // The sidebar was left collapsed to its icons (the NAV_COOKIE)
  initiallyCollapsed: boolean;
};

// Each link's picture, shown beside its name, and alone when the sidebar is collapsed

const links = [
  { href: '/#toolkit', key: 'toolkit', icon: Wrench },
  { href: '/racing', key: 'coachingAnalysis', icon: ChartLine },
  { href: '/cars-tracks', key: 'carsTracks', icon: Car },
  { href: '/expert-laps', key: 'expertLaps', icon: Timer },
  { href: '/prodrivinglesson', key: 'proDriverLesson', icon: GraduationCap },
  { href: '/learning', key: 'learning', icon: BookOpen },
  { href: '/installing', key: 'installing', icon: Download },
  { href: '/support', key: 'support', icon: LifeBuoy },
] as const;

// Signed-out visitors who click these get the Log in box instead of the page
const loginRequiredLinks: ReadonlySet<string> = new Set(['installing', 'coachingAnalysis', 'carsTracks', 'expertLaps', 'support', 'pricing']);

// At the bottom, just above My Settings (or Log In)
const bottomLinks = [
  { href: '/pricing', key: 'pricing', icon: Tag },
  { href: '/race-trends', key: 'raceTrends', icon: TrendingUp },
] as const;

export default function Navigation({ user, showPricing, showProDriverLesson, enableAiFeatures, initiallyCollapsed }: NavigationProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Hidden when the Admin page turns Show Pricing off, and for Gold subscribers, who have nothing left to buy
  const hidePricing = !showPricing || (user !== null && !user.canUpgrade);
  // Hidden when the Admin page turns Show Pro Driver Lesson off
  const visibleLinks = showProDriverLesson ? links : links.filter((link) => link.key !== 'proDriverLesson');
  // My Race Trends is shown to Admins only
  const visibleBottomLinks = bottomLinks.filter(
    (link) => !(hidePricing && link.key === 'pricing') && (link.key !== 'raceTrends' || user?.isAdmin === true)
  );

  // The page whose link opened the Log in box; null while it's closed
  const [loginRequiredFor, setLoginRequiredFor] = useState<string | null>(null);
  const closeLoginRequired = useCallback(() => setLoginRequiredFor(null), []);

  // Large screens: the sidebar collapsed to the red flag and the links' pictures
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  // The name shown beside a collapsed sidebar's picture while it's hovered or focused, at that picture's height
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    setTip(null);
    // globals.css narrows --nav-width, which the layout pads the page by, from <html data-nav>
    if (next) document.documentElement.dataset.nav = NAV_COLLAPSED;
    else delete document.documentElement.dataset.nav;
    document.cookie = `${NAV_COOKIE}=${next ? NAV_COLLAPSED : 'expanded'}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  const showTip = (label: string) => (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2 });
  };
  const hideTip = () => setTip(null);
  const tipProps = (label: string) =>
    collapsed ? { 'aria-label': label, onMouseEnter: showTip(label), onMouseLeave: hideTip, onFocus: showTip(label), onBlur: hideTip } : {};

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  // Opens the Log in box in place of following a link that needs an account
  const guardLink = (key: string, href: string) => (e: MouseEvent) => {
    closeMenu();
    if (user || !loginRequiredLinks.has(key)) return;
    e.preventDefault();
    setLoginRequiredFor(href);
  };

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
  const mobileLink = (href: string) => `flex items-center gap-3 px-3 py-2 rounded-md font-semibold hover:bg-secondary transition-colors ${linkColor(href)}`;

  // A sidebar row: picture and name, or the picture alone when collapsed. The current page's row is shaded,
  // with its picture in red and a red bar on the sidebar's edge
  const sideItem = (href: string | null) => {
    const current = href === pathname;
    return [
      'relative flex items-center gap-3 h-10 w-full rounded-lg font-semibold transition-colors',
      collapsed ? 'justify-center' : 'px-3',
      current
        ? 'bg-secondary text-foreground [&>svg]:text-primary before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70',
    ].join(' ');
  };
  const sideLink = (key: string, href: string, Icon: LucideIcon, label: string, onClick?: (e: MouseEvent) => void) => (
    <Link key={key} href={href} className={sideItem(href)} onClick={onClick} {...tipProps(label)}>
      <Icon className="size-5 shrink-0" strokeWidth={2} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  return (
    // A sidebar down the left side on large screens (the layout pads the page by its width), a bar across the top with a menu below that
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border lg:fixed lg:inset-y-0 lg:left-0 lg:w-(--nav-width) lg:border-b-0 lg:border-r lg:transition-[width] lg:duration-200">
      {/* Desktop Sidebar */}
      {/* Collapse button on the sidebar's edge, outside the scrolling part so it isn't clipped */}
      {!collapsed && (
        <button
          onClick={() => setSidebarCollapsed(true)}
          aria-label={t.nav.collapseMenu}
          title={t.nav.collapseMenu}
          className="hidden lg:grid absolute top-9 -right-3 z-10 size-6 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground hover:border-primary transition-colors"
        >
          <ChevronsLeft className="size-3.5" />
        </button>
      )}
      <div className="hidden lg:flex flex-col h-full overflow-y-auto overflow-x-hidden px-3 py-6 gap-8">
        {/* The logo at the top; collapsed, only its red flag, which opens the sidebar again */}
        {collapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="group mx-auto grid size-12 shrink-0 place-items-center rounded-xl hover:bg-secondary transition-colors"
            {...tipProps(t.nav.expandMenu)}
          >
            <Flag className="size-8 text-primary transition-transform duration-200 group-hover:-rotate-12 group-hover:scale-110" strokeWidth={2.5} />
          </button>
        ) : (
          <div className="px-1 shrink-0">
            <Brand compact aiFeatures={enableAiFeatures} />
          </div>
        )}

        <div className="flex flex-col gap-1">
          {visibleLinks.map((link) => sideLink(link.key, link.href, link.icon, t.nav[link.key], guardLink(link.key, link.href)))}
        </div>

        {/* Desktop Account */}
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
          {user ? (
            <>
              {user.canCoach && sideLink('coach', '/coach', ClipboardList, t.nav.coach)}
              {user.isAdmin && sideLink('admin', '/admin', ShieldCheck, t.nav.admin)}
              {visibleBottomLinks.map((link) => sideLink(link.key, link.href, link.icon, t.nav[link.key]))}
              {sideLink('myAccount', '/account', Settings, t.nav.myAccount)}
              {collapsed ? (
                <>
                  {/* The driver's initial in place of their name */}
                  <span
                    tabIndex={0}
                    className="mx-auto my-2 grid size-9 place-items-center rounded-full bg-accent font-display text-lg font-bold text-foreground"
                    {...tipProps(`${t.nav.driver} ${user.userName}`)}
                  >
                    {user.userName.charAt(0).toUpperCase()}
                  </span>
                  <button onClick={handleLogout} disabled={loggingOut} className={`${sideItem(null)} disabled:opacity-60`} {...tipProps(t.nav.logout)}>
                    <LogOut className="size-5" />
                  </button>
                </>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-3 px-3">
                  <span className="font-semibold text-muted-foreground">{t.nav.driver} <span className="text-foreground">{user.userName}</span></span>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className={buttonVariants({ variant: 'racingOutline', size: 'sm', className: 'disabled:opacity-60' })}
                  >
                    <LogOut /> {t.nav.logout}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {visibleBottomLinks.map((link) => sideLink(link.key, link.href, link.icon, t.nav[link.key], guardLink(link.key, link.href)))}
              {sideLink('logIn', '/login', LogIn, t.nav.logIn)}
              {collapsed ? (
                <Link href="/signup" className="mx-auto mt-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground hover:bg-primary-strong transition-colors" {...tipProps(t.nav.getStarted)}>
                  <UserPlus className="size-5" />
                </Link>
              ) : (
                <Link href="/signup" className={buttonVariants({ variant: 'racing', size: 'sm', className: 'mt-3 self-start ml-3' })}>
                  {t.nav.getStarted} <ArrowRight />
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {/* A collapsed sidebar's names, beside the hovered or focused picture */}
      {collapsed && tip && (
        <div
          role="tooltip"
          style={{ top: tip.top }}
          className="hidden lg:block fixed left-[calc(var(--nav-width)+10px)] z-[60] -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-semibold text-foreground shadow-lg pointer-events-none"
        >
          {tip.label}
        </div>
      )}

      {/* Mobile Bar */}
      <div className="lg:hidden site-container h-[84px] max-sm:h-[72px] flex items-center justify-between gap-[30px] max-sm:gap-3">
        <Brand onClick={closeMenu} aiFeatures={enableAiFeatures} />

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
              <Link key={link.key} href={link.href} className={mobileLink(link.href)} onClick={guardLink(link.key, link.href)}><link.icon className="size-5" />{t.nav[link.key]}</Link>
            ))}
            <div className="border-t border-border pt-2 mt-2">
              {user ? (
                <>
                  {user.canCoach && (
                    <Link href="/coach" className={mobileLink('/coach')} onClick={closeMenu}><ClipboardList className="size-5" />{t.nav.coach}</Link>
                  )}
                  {user.isAdmin && (
                    <Link href="/admin" className={mobileLink('/admin')} onClick={closeMenu}><ShieldCheck className="size-5" />{t.nav.admin}</Link>
                  )}
                  {visibleBottomLinks.map((link) => (
                    <Link key={link.key} href={link.href} className={mobileLink(link.href)} onClick={closeMenu}><link.icon className="size-5" />{t.nav[link.key]}</Link>
                  ))}
                  <Link href="/account" className={mobileLink('/account')} onClick={closeMenu}><Settings className="size-5" />{t.nav.myAccount}</Link>
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
                  {visibleBottomLinks.map((link) => (
                    <Link key={link.key} href={link.href} className={mobileLink(link.href)} onClick={guardLink(link.key, link.href)}><link.icon className="size-5" />{t.nav[link.key]}</Link>
                  ))}
                  <Link href="/login" className={mobileLink('/login')} onClick={closeMenu}><LogIn className="size-5" />{t.nav.logIn}</Link>
                  <Link href="/signup" className={mobileLink('/signup')} onClick={closeMenu}><UserPlus className="size-5" />{t.nav.getStarted}</Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <LoginRequiredDialog open={loginRequiredFor !== null} returnTo={loginRequiredFor ?? '/'} onClose={closeLoginRequired} />
    </nav>
  );
}
