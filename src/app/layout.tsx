import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import ActivityTracker from "@/components/ActivityTracker";
import ConsentGate from "@/components/ConsentGate";
import CookieConsentProvider from "@/components/CookieConsentProvider";
import CookieSettingsButton from "@/components/CookieSettingsButton";
import LanguageProvider from "@/components/LanguageProvider";
import Navigation from "@/components/Navigation";
import PolicyUpdateNotice from "@/components/PolicyUpdateNotice";
import RateLimitDialog from "@/components/RateLimitDialog";
import UnitsProvider from "@/components/UnitsProvider";
import { getConsentState } from "@/lib/cookieConsentServer";
import { getDictionary, getLanguage } from "@/lib/i18n/server";
import { hasAcceptedCurrentPolicies } from "@/lib/policyAcceptances";
import { canCoach, isAdmin } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { getEnableAiFeatures, getShowPricing, getShowProDriverLesson } from "@/lib/siteSettings";
import { getTheme } from "@/lib/themeServer";
import { getUnits } from "@/lib/unitsServer";
import { canBuyAnything } from "@/lib/users";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLanguage());
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, showPricing, showProDriverLesson, enableAiFeatures] = await Promise.all([
    getCurrentUser(),
    getShowPricing(),
    getShowProDriverLesson(),
    getEnableAiFeatures(),
  ]);
  // Every page is in the user's Preferred Language (or a visitor's chosen one); client components get
  // the dictionary from LanguageProvider
  const language = await getLanguage(user);
  const t = getDictionary(language);
  // Dark Mode or Light Mode (the Account page's Theme toggle); globals.css switches the colors on data-theme
  const theme = await getTheme(user);
  // Standard (feet, mph, °F) or Metric (meters, kph, °C), the Account page's Preferred Units; client
  // components get them from UnitsProvider
  const units = await getUnits(user);
  // A signed-in user who hasn't accepted the current Terms of Service and Privacy Policy is asked to, above the page
  // (no notice if the check fails)
  const needsPolicyAcceptance = user ? !(await hasAcceptedCurrentPolicies(user.id).catch(() => true)) : false;
  // The visitor's cookie choices, read here so optional technologies are left out from the first render
  // (src/lib/cookieConsentServer.ts); CookieConsentProvider shows the banner when a choice is needed
  const consent = await getConsentState();

  return (
    <html
      lang={language}
      data-theme={theme}
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-screen bg-background text-foreground flex flex-col">
        <LanguageProvider language={language} dictionary={t}>
          <UnitsProvider units={units}>
            <CookieConsentProvider initial={{ needsChoice: consent.needsChoice, reconsent: consent.reconsent, granted: consent.granted }}>
              {/* The activity log is analytics: it only runs with consent */}
              <ConsentGate category="analytics">
                <ActivityTracker />
              </ConsentGate>
              {/* Pops up when an AI feature was refused because the user's AI limit is used up */}
              <RateLimitDialog />
              <Navigation
                user={user ? { userName: user.userName, canUpgrade: canBuyAnything(user), isAdmin: isAdmin(user.role), canCoach: canCoach(user.role) } : null}
                showPricing={showPricing}
                showProDriverLesson={showProDriverLesson}
                enableAiFeatures={enableAiFeatures}
              />
              {/* On large screens the nav is a fixed sidebar down the left (with the logo at its top), so the page
                  starts after its collapsed width, and it opens over the page */}
              <div className="flex-1 flex flex-col lg:pl-(--nav-width)">
                {needsPolicyAcceptance && <PolicyUpdateNotice />}
                <main className="flex-1">
                  {children}
                </main>
                <footer className="border-t border-border py-6">
                  <div className="w-full px-4 flex items-center justify-end gap-5">
                    <div className="text-[10px] text-muted-foreground text-right max-sm:max-w-[140px]">
                      <p>© 2026 RacingCoach.app<br />{t.footer.tagline}</p>
                      <nav aria-label={t.legal.pageTitle} className="mt-1.5 flex flex-wrap justify-end gap-x-2">
                        <Link href="/privacy" className="hover:text-foreground hover:underline">{t.footer.privacy}</Link>
                        <span aria-hidden>·</span>
                        <Link href="/terms" className="hover:text-foreground hover:underline">{t.footer.terms}</Link>
                        <span aria-hidden>·</span>
                        <Link href="/cookies" className="hover:text-foreground hover:underline">{t.footer.cookies}</Link>
                        <span aria-hidden>·</span>
                        <CookieSettingsButton label={t.footer.cookieSettings} className="cursor-pointer hover:text-foreground hover:underline" />
                        <span aria-hidden>·</span>
                        <Link href="/support" className="hover:text-foreground hover:underline">{t.footer.contact}</Link>
                      </nav>
                    </div>
                  </div>
                </footer>
              </div>
            </CookieConsentProvider>
          </UnitsProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
