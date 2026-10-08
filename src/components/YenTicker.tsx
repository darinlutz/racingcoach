'use client';

import { useEffect, useState } from 'react';
import { JapaneseYen } from 'lucide-react';

interface YenRate {
  rate: number;
  symbol: string;
  timestamp: number;
}

export default function YenTicker() {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let ignore = false;

    const fetchYenRate = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiUrl = new URL('/api/yen', window.location.origin).toString();
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch USD/JPY rate');

        const data: YenRate = await response.json();
        if (ignore) return;
        setRate(data.rate);
        setLastUpdate(new Date());
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch rate');
        console.error('Yen rate fetch error:', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchYenRate();

    // Poll every 30 seconds
    const interval = setInterval(fetchYenRate, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-gradient-to-r from-background to-background border border-border rounded-lg p-6 shadow-xl">
      <div className="flex flex-col items-center text-center">
        <p className="text-muted-foreground text-sm uppercase tracking-wide mb-2">Yen</p>
        {loading && !rate ? (
          <div className="animate-pulse h-8 bg-accent w-32 rounded"></div>
        ) : error ? (
          <p className="text-primary text-sm">{error}</p>
        ) : rate !== null ? (
          <div>
            <p className="flex items-center justify-center gap-2 text-3xl font-bold text-foreground">
              <JapaneseYen className="w-7 h-7 flex-shrink-0 text-foreground" aria-hidden="true" />
              {rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {lastUpdate && (
              <p className="text-xs text-muted-foreground mt-1">
                Updated: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Rate unavailable</p>
        )}
      </div>
    </div>
  );
}
