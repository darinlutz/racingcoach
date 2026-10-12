import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import ActivityTracker from "@/components/ActivityTracker";
import Brand from "@/components/Brand";
import LanguageProvider from "@/components/LanguageProvider";
import Navigation from "@/components/Navigation";
import { getDictionary, getLanguage } from "@/lib/i18n/server";
import { isAdmin } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";
import { getShowPricing } from "@/lib/siteSettings";
import { getTheme } from "@/lib/themeServer";
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
  const [user, showPricing] = await Promise.all([getCurrentUser(), getShowPricing()]);
  // Every page is in the user's Preferred Language (or a visitor's chosen one); client components get
  // the dictionary from LanguageProvider
  const language = await getLanguage(user);
  const t = getDictionary(language);
  // Dark Mode or Light Mode (the Account page's Theme toggle); globals.css switches the colors on data-theme
  const theme = await getTheme(user);

  return (
    <html
      lang={language}
      data-theme={theme}
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-screen bg-background text-foreground flex flex-col">
        <LanguageProvider language={language} dictionary={t}>
          <ActivityTracker />
          <Navigation
            user={user ? { userName: user.userName, canUpgrade: canBuyAnything(user), isAdmin: isAdmin(user.role) } : null}
            showPricing={showPricing}
          />
          <main className="flex-1">
            {children}
          </main>
          <footer className="border-t border-border py-6">
            <div className="site-container flex items-center justify-between gap-5">
              <Brand />
              <p className="text-[10px] text-muted-foreground text-right max-sm:max-w-[140px]">
                © 2026 RacingCoach.app<br />{t.footer.tagline}
              </p>
            </div>
          </footer>
        </LanguageProvider>
      </body>
    </html>
  );
}
