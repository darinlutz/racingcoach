'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type NavigationProps = {
  user: { userName: string } | null;
};

export default function Navigation({ user }: NavigationProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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

  return (
    <nav className="fixed w-full top-0 z-50 bg-white border-b border-slate-200 shadow-md">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center space-x-2 group"
            onClick={closeMenu}
          >
            <Image
              src="/assets/svg/clarivex_logo_white.svg"
              alt="Clarivex Logo"
              width={300}
              height={90}
              priority
              style={{ width: "180px", height: "auto" }}
              className="group-hover:shadow-lg group-hover:shadow-powder-500/50 transition-all"
            />
      
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link
              href="/"
              className="px-3 py-2 text-dark-blue hover:text-powder-600 transition-colors font-medium"
            >
              Home 
            </Link>
            <p>&nbsp;&nbsp;|&nbsp;&nbsp;</p>
            <Link
              href="/racing"
              className="px-3 py-2 text-dark-blue hover:text-powder-600 transition-colors font-medium"
            >
              Racing
            </Link>
          </div>

          {/* Desktop Account */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <>
                <Link
                  href="/account"
                  className="px-3 py-2 text-dark-blue hover:text-powder-600 transition-colors font-medium whitespace-nowrap"
                >
                  My Account
                </Link>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="px-4 py-2 rounded-lg border border-powder-600 text-powder-600 font-medium hover:bg-powder-600 hover:text-white transition-colors disabled:opacity-60"
                >
                  Logout
                </button>
                <span className="text-dark-blue font-medium whitespace-nowrap">Driver: {user.userName}</span>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-3 py-2 text-dark-blue hover:text-powder-600 transition-colors font-medium whitespace-nowrap"
                >
                  Log In
                </Link>
                <Link
                  href="/signup"
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-powder-500 to-powder-600 text-white font-medium hover:shadow-lg transition-all whitespace-nowrap"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={toggleMenu}
            className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-dark-blue hover:text-powder-600 focus:outline-none transition-colors"
            aria-expanded="false"
          >
            <svg
              className={`h-6 w-6 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              stroke="currentColor"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="md:hidden bg-slate-50 border-t border-slate-200">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            <Link
              href="/"
              className="block px-3 py-2 rounded-md text-base font-medium text-dark-blue hover:text-powder-600 hover:bg-slate-100 transition-colors"
              onClick={closeMenu}
            >
              Home
            </Link>
            <Link
              href="/racing"
              className="block px-3 py-2 rounded-md text-base font-medium text-dark-blue hover:text-powder-600 hover:bg-slate-100 transition-colors"
              onClick={closeMenu}
            >
              Racing
            </Link>
            <div className="border-t border-slate-200 pt-2 mt-2">
              {user ? (
                <>
                  <Link
                    href="/account"
                    className="block px-3 py-2 rounded-md text-base font-medium text-dark-blue hover:text-powder-600 hover:bg-slate-100 transition-colors"
                    onClick={closeMenu}
                  >
                    My Account
                  </Link>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="px-4 py-2 rounded-lg border border-powder-600 text-powder-600 font-medium hover:bg-powder-600 hover:text-white transition-colors disabled:opacity-60"
                    >
                      Logout
                    </button>
                    <span className="text-base font-medium text-dark-blue">Driver: {user.userName}</span>
                  </div>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="block px-3 py-2 rounded-md text-base font-medium text-dark-blue hover:text-powder-600 hover:bg-slate-100 transition-colors"
                    onClick={closeMenu}
                  >
                    Log In
                  </Link>
                  <Link
                    href="/signup"
                    className="block px-3 py-2 rounded-md text-base font-medium text-dark-blue hover:text-powder-600 hover:bg-slate-100 transition-colors"
                    onClick={closeMenu}
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
