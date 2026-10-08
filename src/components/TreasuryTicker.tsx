'use client';

import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';

interface TreasuryYield {
  yield: number;
  symbol: string;
  timestamp: number;
}

export default function TreasuryTicker() {
  const [yieldValue, setYieldValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let ignore = false;

    const fetchTreasuryYield = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = new URL('/api/treasury', window.location.origin).toString();
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch 10Y Treasury yield');

        const data: TreasuryYield = await response.json();
        if (ignore) return;
        setYieldValue(data.yield);
        setLastUpdate(new Date());
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch yield');
        console.error('Treasury yield fetch error:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchTreasuryYield();

    // Poll every 30 seconds
    const interval = setInterval(fetchTreasuryYield, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-gradient-to-r from-background to-background border border-border rounded-lg p-6 shadow-xl">
      <div className="flex flex-col items-center text-center">
        <p className="text-muted-foreground text-sm uppercase tracking-wide mb-2">10Y Note</p>
        {loading && !yieldValue ? (
          <div className="animate-pulse h-8 bg-accent w-32 rounded"></div>
        ) : error ? (
          <p className="text-primary text-sm">{error}</p>
        ) : yieldValue !== null ? (
          <div>
            <p className="flex items-center justify-center gap-2 text-3xl font-bold text-foreground">
              <Landmark className="w-7 h-7 flex-shrink-0 text-foreground" aria-hidden="true" />
              {yieldValue.toFixed(2)}%
            </p>
            {lastUpdate && (
              <p className="text-xs text-muted-foreground mt-1">
                Updated: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Yield unavailable</p>
        )}
      </div>
    </div>
  );
}
