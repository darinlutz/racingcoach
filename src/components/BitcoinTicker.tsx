'use client';

import { useEffect, useState } from 'react';

interface BitcoinPrice {
  price: number;
  symbol: string;
  timestamp: number;
}

function BitcoinCoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#F7931A" />
      <path
        d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="rotate(-10 12 12)"
      />
    </svg>
  );
}

export default function BitcoinTicker() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let ignore = false;

    const fetchBitcoinPrice = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = new URL('/api/bitcoin', window.location.origin).toString();
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch Bitcoin price');

        const data: BitcoinPrice = await response.json();
        if (ignore) return;
        setPrice(data.price);
        setLastUpdate(new Date());
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch price');
        console.error('Bitcoin price fetch error:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchBitcoinPrice();

    // Poll every 30 seconds
    const interval = setInterval(fetchBitcoinPrice, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-gradient-to-r from-background to-background border border-border rounded-lg p-6 shadow-xl">
      <div className="flex flex-col items-center text-center">
        <p className="text-muted-foreground text-sm uppercase tracking-wide mb-2">Bitcoin</p>
        {loading && !price ? (
          <div className="animate-pulse h-8 bg-accent w-32 rounded"></div>
        ) : error ? (
          <p className="text-primary text-sm">{error}</p>
        ) : price !== null ? (
          <div>
            <p className="flex items-center justify-center gap-2 text-3xl font-bold text-foreground">
              <BitcoinCoinIcon className="w-7 h-7 flex-shrink-0" />
              ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {lastUpdate && (
              <p className="text-xs text-muted-foreground mt-1">
                Updated: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Price unavailable</p>
        )}
      </div>
    </div>
  );
}
