'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import type { EngineAudioAsset } from '@/lib/engineAudioAssets';
import { MAX_ENGINE_AUDIO_BYTES } from '@/lib/engineBedConfig';

// The Admin page's Engine Sounds (src/lib/engineAudioAssets.ts): MP3 or WAV files that any listener can pick in their
// Race Broadcast preferences for the engine sound under ElevenLabs speech, beside the built-in one.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';

export default function EngineAudioLibrary() {
  const { t, fmt } = useLanguage();
  const e = t.admin.engineAudio;
  const [assets, setAssets] = useState<EngineAudioAsset[]>([]);
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/broadcast/engine-audio');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssets(data.assets);
      setStorageConfigured(data.storageConfigured);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : e.failedLoad);
    }
  }, [e.failedLoad]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once
    load();
  }, [load]);

  const upload = async () => {
    if (!file) return;
    if (file.size > MAX_ENGINE_AUDIO_BYTES) {
      setError(e.fileTooLarge);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name);
      const res = await fetch('/api/admin/broadcast/engine-audio', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? e.failedSave);
      setName('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : e.failedSave);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (asset: EngineAudioAsset) => {
    if (!window.confirm(fmt(e.confirmRemove, { name: asset.name }))) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/broadcast/engine-audio/${asset.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? e.failedSave);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : e.failedSave);
    }
  };

  return (
    <div id="engine-audio-library" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{e.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{e.intro}</p>
      </div>

      {!storageConfigured && <p className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">{e.storageMissing}</p>}
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

      {storageConfigured && (
        <div className="rounded-lg border border-border p-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="engine-audio-file" className={labelClass}>{e.file}</label>
            <input
              id="engine-audio-file"
              ref={fileInput}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="engine-audio-name" className={labelClass}>{e.name}</label>
            <input id="engine-audio-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </div>
          <button
            type="button"
            onClick={upload}
            disabled={!file || uploading}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50"
          >
            {uploading ? e.uploading : e.upload}
          </button>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        <li className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-foreground">
          {e.builtIn}
        </li>
        {assets.map((asset) => (
          <li key={asset.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-foreground">
            <span className="min-w-0 truncate">{asset.name}</span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">{(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
              <button
                type="button"
                onClick={() => remove(asset)}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors"
              >
                {e.remove}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
