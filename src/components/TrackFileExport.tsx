'use client';

import { useState } from 'react';
import { trackFileText } from '@/lib/trackFile';

// Save Data downloads the file under this name, to be saved in
// C:\Program Files (x86)\SimHub\DashTemplates\AreaTimeAndSpeed\JavascriptExtensions
const SIMHUB_FILE_NAME = 'Track_Area_Information.js';

// Rebuilds Track_Area_Information.txt from the user's saved tracks so it can be copied into the file
export default function TrackFileExport() {
  const [text, setText] = useState('');
  const [canSave, setCanSave] = useState(false);
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
      setCanSave(data.isAdmin === true);
      setStatus('idle');
    } catch (error) {
      setStatus('idle');
      setMessage(error instanceof Error ? error.message : 'Failed to generate the text file');
    }
  };

  // The site can't write to a folder on the visitor's PC, so this downloads the file through the browser
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = SIMHUB_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
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
        className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'loading' ? 'Generating…' : 'Generate Text File'}
      </button>

      {message && <div className="p-3 rounded-lg bg-primary/15 border border-primary/40 text-red-300 text-sm">{message}</div>}

      {text && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="track-file-text" className="text-sm font-medium text-foreground">
              Track_Area_Information.txt{' '}
              <span className="font-normal text-muted-foreground">({text.split('\n').length.toLocaleString('en-US')} lines)</span>
            </label>
            <div className="flex shrink-0 gap-2">
              {canSave && (
                <button
                  type="button"
                  onClick={save}
                  className="px-4 py-2 text-sm font-semibold bg-card border border-border rounded-lg text-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  Save Data
                </button>
              )}
              <button
                type="button"
                onClick={() => void copy()}
                className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-primary to-primary-strong text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                {status === 'copied' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <textarea
            id="track-file-text"
            readOnly
            value={text}
            rows={8}
            spellCheck={false}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg font-mono text-xs text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      )}
    </div>
  );
}
