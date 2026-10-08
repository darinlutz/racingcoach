'use client';

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

interface GoldPrice {
  price: number;
  symbol: string;
  timestamp: number;
}

export default function GoldTicker() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let ignore = false;

    const fetchGoldPrice = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = new URL('/api/gold', window.location.origin).toString();
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch gold price');

        const data: GoldPrice = await response.json();
        if (ignore) return;
        setPrice(data.price);
        setLastUpdate(new Date());
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch price');
        console.error('Gold price fetch error:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchGoldPrice();

    // Poll every 30 seconds
    const interval = setInterval(fetchGoldPrice, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-gradient-to-r from-background to-background border border-border rounded-lg p-6 shadow-xl">
      <div className="flex flex-col items-center text-center">
        <p className="text-muted-foreground text-sm uppercase tracking-wide mb-2">Gold</p>
        {loading && !price ? (
          <div className="animate-pulse h-8 bg-accent w-32 rounded"></div>
        ) : error ? (
          <p className="text-primary text-sm">{error}</p>
        ) : price !== null ? (
          <div>
            <p className="flex items-center justify-center gap-2 text-3xl font-bold text-foreground">
              <Coins className="w-7 h-7 flex-shrink-0 text-amber-500" aria-hidden="true" />
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
