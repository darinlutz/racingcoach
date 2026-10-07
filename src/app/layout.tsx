import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navigation from "@/components/Navigation";
import { getCurrentUser } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clarivex - Tackling Complex Problems with Clear Solutions",
  description: "Clarivex specializes in helping businesses automate and streamline their repetitive processes with clarity and efficiency.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="min-h-screen bg-white text-dark-blue flex flex-col">
        <Navigation user={user ? { userName: user.userName } : null} />
        <main className="flex-1 pt-16">
          {children}
        </main>
      </body>
    </html>
  );
}
