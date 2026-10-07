'use client';

import { useState } from 'react';
import { trackFileText } from '@/lib/trackFile';

// Rebuilds Track_Area_Information.txt from the user's saved tracks so it can be copied into the file
export default function TrackFileExport() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [message, setMessage] = useState('');

  const generate = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const response = await fetch('/api/tracks');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load tracks');
      setText(trackFileText(data.tracks));
      setStatus('idle');
    } catch (error) {
      setStatus('idle');
      setMessage(error instanceof Error ? error.message : 'Failed to generate the text file');
    }
  };

  const copy = async () => {
    setMessage('');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      setTimeout(() => setStatus((s) => (s === 'copied' ? 'idle' : s)), 2000);
    } catch {
      setMessage('Could not copy to the clipboard. Select the text and copy it instead.');
    }
  };

  return (
    <div className="mb-6 space-y-3">
      <button
        type="button"
        onClick={() => void generate()}
        disabled={status === 'loading'}
        className="px-4 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg text-dark-blue hover:border-powder-600 hover:text-powder-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'loading' ? 'Generating…' : 'Generate Text File'}
      </button>

      {message && <div className="p-3 rounded-lg bg-red-100 border border-red-300 text-red-800 text-sm">{message}</div>}

      {text && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="track-file-text" className="text-sm font-medium text-dark-blue">
              Track_Area_Information.txt{' '}
              <span className="font-normal text-slate-500">({text.split('\n').length.toLocaleString('en-US')} lines)</span>
            </label>
            <button
              type="button"
              onClick={() => void copy()}
              className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-powder-500 to-powder-600 text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              {status === 'copied' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <textarea
            id="track-file-text"
            readOnly
            value={text}
            rows={8}
            spellCheck={false}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-xs text-dark-blue focus:outline-none focus:border-powder-600 focus:ring-1 focus:ring-powder-500"
          />
        </div>
      )}
    </div>
  );
}
