'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { COUNTRIES } from '@/lib/countries';

type Friend = {
  id: string;
  name: string;
  country: string;
};

export default function FriendsRoster() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<string>('Brazil');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  // Each user has their own list, so visitors who aren't logged in get a prompt instead
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    fetch('/api/friends-roster')
      .then((response) => {
        if (response.status === 401) {
          setSignedOut(true);
          return { friends: [] };
        }
        return response.json();
      })
      .then((data) => setFriends(data.friends ?? []))
      .catch(() => setMessage('Failed to load friends'));
  }, []);

  if (signedOut) {
    return (
      <div className="bg-secondary rounded-xl border border-border p-8 text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>{' '}
        to see and add your friends.
      </div>
    );
  }

  const handleAddFriend = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setStatus('loading');
    setMessage('');

    try {
      const response = await fetch('/api/friends-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, country }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add friend');
      }

      setFriends((prev) => [...prev, data.friend]);
      setName('');
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Failed to add friend');
    }
  };

  const handleDeleteFriend = async (id: string) => {
    setMessage('');

    try {
      const response = await fetch('/api/friends-roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete friend');
      }

      setFriends((prev) => prev.filter((friend) => friend.id !== id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete friend');
    }
  };

  return (
    <div className="bg-secondary rounded-xl border border-border p-8">
      <div className="flex flex-col sm:flex-row gap-3 mb-2">
        <div className="sm:w-48 flex-shrink-0">
          <label htmlFor="friend-country" className="block text-sm font-medium text-foreground mb-2">
            Country
          </label>
          <select
            id="friend-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="friend-name" className="block text-sm font-medium text-foreground mb-2">
            Name
          </label>
          <input
            id="friend-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
            placeholder="Enter a friend's name"
            className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={handleAddFriend}
          disabled={!name.trim() || status === 'loading'}
          className="px-4 py-2 bg-gradient-to-r from-primary to-primary-strong text-white font-bold rounded-lg hover:shadow-lg hover:shadow-primary/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 disabled:hover:scale-100 flex-shrink-0 sm:self-end"
        >
          {status === 'loading' ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></span>
          ) : (
            'Add Friend'
          )}
        </button>
      </div>

      {message && (
        <div className="mt-4 p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">
          {message}
        </div>
      )}

      <div className="mt-6 space-y-2">
        {friends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No friends added yet.</p>
        ) : (
          friends.map((friend) => (
            <div
              key={friend.id}
              className="flex items-center justify-between px-4 py-3 bg-card border border-border rounded-lg"
            >
              <span className="text-foreground">
                {friend.country && <span className="text-muted-foreground">{friend.country} — </span>}
                {friend.name}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteFriend(friend.id)}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
