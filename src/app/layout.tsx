import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Brand from "@/components/Brand";
import Navigation from "@/components/Navigation";
import { getCurrentUser } from "@/lib/session";
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

export const metadata: Metadata = {
  title: "RacingCoach.app — Your AI Race Engineer",
  description: "Data-driven sim racing coaching, lap comparison and race analysis.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-screen bg-background text-foreground flex flex-col">
        <Navigation user={user ? { userName: user.userName } : null} />
        <main className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border py-6">
          <div className="site-container flex items-center justify-between gap-5">
            <Brand />
            <p className="text-[10px] text-muted-foreground text-right max-sm:max-w-[140px]">
              © 2026 RacingCoach.app<br />Built for sim racers. Driven by data.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
