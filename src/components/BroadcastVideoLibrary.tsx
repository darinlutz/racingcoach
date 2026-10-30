'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { MAX_VIDEO_BYTES, VIDEO_CATEGORIES, VIDEO_EXTENSIONS, type VideoCategory } from '@/lib/broadcastVideoCategories';
import type { LibraryVideo } from '@/lib/broadcastVideos';

// The Admin page's Broadcast Video Library (src/lib/broadcastVideos.ts): upload clips for the Broadcast Director, several
// at a time, straight to object storage with a progress bar, then see them by category with how many each has, preview
// them, edit their details, turn them on or off and delete them. While any clip is being checked or transcoded the list
// keeps itself up to date.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors disabled:opacity-50';
const primaryClass = 'px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors disabled:opacity-50';
const POLL_MS = 4000;

type Option = { id: number; name: string };
type Details = {
  title: string;
  description: string;
  category: VideoCategory;
  trackId: string;
  carId: string;
  durationSeconds: string;
  clipStartSeconds: string;
  clipEndSeconds: string;
  audioEnabled: boolean;
  priority: string;
  selectionWeight: string;
  enabled: boolean;
  cameraPerspective: string;
  sessionInfo: string;
  commentaryContext: string;
};
type Upload = { name: string; percent: number; error: string | null; done: boolean };

const EMPTY: Details = {
  title: '',
  description: '',
  category: 'ONBOARDS',
  trackId: '',
  carId: '',
  durationSeconds: '',
  clipStartSeconds: '',
  clipEndSeconds: '',
  audioEnabled: false,
  priority: '0',
  selectionWeight: '1',
  enabled: true,
  cameraPerspective: '',
  sessionInfo: '',
  commentaryContext: '',
};

const detailsOf = (v: LibraryVideo): Details => ({
  title: v.title,
  description: v.description,
  category: v.category,
  trackId: v.trackId == null ? '' : String(v.trackId),
  carId: v.carId == null ? '' : String(v.carId),
  durationSeconds: v.durationSeconds == null ? '' : String(v.durationSeconds),
  clipStartSeconds: v.clipStartSeconds ? String(v.clipStartSeconds) : '',
  clipEndSeconds: v.clipEndSeconds == null ? '' : String(v.clipEndSeconds),
  audioEnabled: v.audioEnabled,
  priority: String(v.priority),
  selectionWeight: String(v.selectionWeight),
  enabled: v.enabled,
  cameraPerspective: v.cameraPerspective,
  sessionInfo: v.sessionInfo,
  commentaryContext: v.commentaryContext,
});

const numberOrNull = (text: string) => (text.trim() === '' ? null : Number(text));

// As the API takes them. A number box left empty means no value; the API refuses anything that's not a number
const payloadOf = (d: Details) => ({
  title: d.title.trim(),
  description: d.description,
  category: d.category,
  trackId: numberOrNull(d.trackId),
  carId: numberOrNull(d.carId),
  durationSeconds: numberOrNull(d.durationSeconds),
  clipStartSeconds: numberOrNull(d.clipStartSeconds) ?? 0,
  clipEndSeconds: numberOrNull(d.clipEndSeconds),
  audioEnabled: d.audioEnabled,
  priority: numberOrNull(d.priority) ?? 0,
  selectionWeight: numberOrNull(d.selectionWeight) ?? 1,
  enabled: d.enabled,
  cameraPerspective: d.cameraPerspective,
  sessionInfo: d.sessionInfo,
  commentaryContext: d.commentaryContext,
});

function putFile(url: string, file: File, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Storage answered ${request.status}`)));
    request.onerror = () => reject(new Error('network'));
    request.send(file);
  });
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function VideoFields({ value, onChange, tracks, cars, showTitle }: { value: Details; onChange: (d: Details) => void; tracks: Option[]; cars: Option[]; showTitle: boolean }) {
  const { t } = useLanguage();
  const b = t.admin.broadcast;
  const set = <K extends keyof Details>(key: K, v: Details[K]) => onChange({ ...value, [key]: v });
  const text = (key: keyof Details, label: string, hint?: string) => (
    <div>
      <label className={labelClass}>{label}</label>
      <input value={value[key] as string} onChange={(e) => set(key, e.target.value as never)} placeholder={hint} className={inputClass} />
    </div>
  );
  const number = (key: keyof Details, label: string, hint?: string) => (
    <div>
      <label className={labelClass}>{label}</label>
      <input type="number" min="0" step="any" value={value[key] as string} onChange={(e) => set(key, e.target.value as never)} placeholder={hint} className={inputClass} />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label className={labelClass}>{b.category}</label>
        <select value={value.category} onChange={(e) => set('category', e.target.value as VideoCategory)} className={inputClass} data-testid="video-category">
          {VIDEO_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {b.categories[c]}
            </option>
          ))}
        </select>
      </div>
      {showTitle && text('title', b.videoTitle, b.videoTitleHint)}
      <div>
        <label className={labelClass}>{b.track}</label>
        <select value={value.trackId} onChange={(e) => set('trackId', e.target.value)} className={inputClass}>
          <option value="">{b.anyTrack}</option>
          {tracks.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>{b.car}</label>
        <select value={value.carId} onChange={(e) => set('carId', e.target.value)} className={inputClass}>
          <option value="">{b.anyCar}</option>
          {cars.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      {number('durationSeconds', b.duration, b.durationHint)}
      {number('clipStartSeconds', b.clipStart, '0')}
      {number('clipEndSeconds', b.clipEnd, b.clipEndHint)}
      {number('priority', b.priority, '0')}
      {number('selectionWeight', b.selectionWeight, '1')}
      {text('cameraPerspective', b.cameraPerspective)}
      {text('sessionInfo', b.sessionInfo)}
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={labelClass}>{b.description}</label>
        <textarea value={value.description} onChange={(e) => set('description', e.target.value)} rows={2} className={inputClass} />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <label className={labelClass}>{b.commentaryContext}</label>
        <textarea value={value.commentaryContext} onChange={(e) => set('commentaryContext', e.target.value)} rows={2} placeholder={b.commentaryContextHint} className={inputClass} />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={value.audioEnabled} onChange={(e) => set('audioEnabled', e.target.checked)} className="accent-primary" />
        {b.audioEnabled}
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set('enabled', e.target.checked)} className="accent-primary" />
        {b.enabled}
      </label>
    </div>
  );
}

export default function BroadcastVideoLibrary() {
  const { t, fmt } = useLanguage();
  const b = t.admin.broadcast;
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null);
  const [tracks, setTracks] = useState<Option[]>([]);
  const [cars, setCars] = useState<Option[]>([]);
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState<Details>(EMPTY);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<{ id: number; details: Details } | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/broadcast/videos', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? b.failedLoad);
        return;
      }
      setVideos(data.videos);
      setTracks(data.tracks);
      setCars(data.cars);
      setStorageConfigured(data.storageConfigured);
    } catch {
      setError(b.failedLoad);
    }
  }, [b.failedLoad]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list when the section opens
    load();
  }, [load]);

  const working = videos?.some((v) => v.status === 'processing' || v.status === 'transcoding') ?? false;
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [working, load]);

  const statusText = (v: LibraryVideo) => (v.status === 'failed' ? b.failures[(v.statusDetail ?? 'unknown') as keyof typeof b.failures] ?? b.failures.unknown : b.statuses[v.status]);

  const setUpload = (i: number, change: Partial<Upload>) => setUploads((list) => list.map((u, n) => (n === i ? { ...u, ...change } : u)));

  const upload = async () => {
    setUploading(true);
    setError('');
    setUploads(files.map((f) => ({ name: f.name, percent: 0, error: null, done: false })));
    const details = payloadOf(form);
    for (const [i, file] of files.entries()) {
      try {
        if (file.size > MAX_VIDEO_BYTES) throw new Error(b.fileTooLarge);
        // One file takes the title typed; several are named after their files, to be edited afterwards
        const title = files.length === 1 && details.title ? details.title : file.name.replace(/\.[^.]+$/, '');
        const created = await fetch('/api/admin/broadcast/videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...details, title, fileName: file.name, sizeBytes: file.size, contentType: file.type || undefined }),
        });
        const data = await created.json();
        if (!created.ok) throw new Error(data.error ?? b.failedSave);
        await putFile(data.uploadUrl, file, data.contentType, (percent) => setUpload(i, { percent }));
        const finished = await fetch(`/api/admin/broadcast/videos/${data.video.id}/complete`, { method: 'POST' });
        const done = await finished.json();
        if (!finished.ok) throw new Error(done.error ?? b.failedSave);
        setUpload(i, { percent: 100, done: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : b.failedSave;
        setUpload(i, { error: message === 'network' ? b.uploadBlocked : message });
      }
      await load();
    }
    setFiles([]);
    setForm(EMPTY);
    setUploading(false);
  };

  const patch = async (id: number, body: object) => {
    setError('');
    const response = await fetch(`/api/admin/broadcast/videos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(data?.error ?? b.failedSave);
      return false;
    }
    await load();
    return true;
  };

  const remove = async (v: LibraryVideo) => {
    if (!window.confirm(fmt(b.confirmDelete, { title: v.title }))) return;
    const response = await fetch(`/api/admin/broadcast/videos/${v.id}`, { method: 'DELETE' }).catch(() => null);
    if (!response?.ok) setError(b.failedSave);
    await load();
  };

  return (
    <div id="broadcast-video-library" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">{b.libraryTitle}</h2>
        <p className="text-sm text-muted-foreground mt-1">{b.libraryIntro}</p>
      </div>

      {!storageConfigured && <p className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">{b.storageMissing}</p>}
      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

      {storageConfigured && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <label className={labelClass}>{b.files}</label>
            <input
              type="file"
              multiple
              data-testid="video-files"
              accept={VIDEO_EXTENSIONS.map((e) => `.${e}`).join(',')}
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
              className="block text-sm text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">{b.filesHint}</p>
          </div>
          <VideoFields value={form} onChange={setForm} tracks={tracks} cars={cars} showTitle={files.length <= 1} />
          <button type="button" onClick={upload} disabled={uploading || files.length === 0} className={primaryClass}>
            {uploading ? b.uploading : files.length > 1 ? fmt(b.uploadMany, { n: files.length }) : b.upload}
          </button>
          {uploads.length > 0 && (
            <ul className="space-y-2">
              {uploads.map((u) => (
                <li key={u.name} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="truncate text-foreground">{u.name}</span>
                    <span className={u.error ? 'text-red-500' : 'text-muted-foreground tabular-nums'}>{u.error ?? (u.done ? b.uploaded : `${u.percent}%`)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-card">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${u.percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {videos === null ? (
        <p className="text-sm text-muted-foreground">{b.loading}</p>
      ) : (
        <div className="space-y-5">
          {VIDEO_CATEGORIES.map((category) => {
            const list = videos.filter((v) => v.category === category);
            return (
              <section key={category} data-testid={`category-${category}`}>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  {b.categories[category]} <span className="font-normal text-muted-foreground tabular-nums">({list.length})</span>
                </h3>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{b.noVideos}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {list.map((v) => (
                      <li key={v.id} className="p-3 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{v.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[
                                statusText(v),
                                v.durationSeconds != null ? fmt(b.seconds, { n: Math.round(v.durationSeconds * 10) / 10 }) : null,
                                v.track,
                                v.car,
                                formatSize(v.sizeBytes),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="checkbox" checked={v.enabled} onChange={(e) => patch(v.id, { enabled: e.target.checked })} className="accent-primary" />
                            {b.enabled}
                          </label>
                          {v.status === 'ready' && (
                            <button type="button" className={buttonClass} onClick={() => setPreviewing(previewing === v.id ? null : v.id)}>
                              {previewing === v.id ? b.closePreview : b.preview}
                            </button>
                          )}
                          <button type="button" className={buttonClass} onClick={() => setEditing(editing?.id === v.id ? null : { id: v.id, details: detailsOf(v) })}>
                            {b.edit}
                          </button>
                          <button type="button" className={buttonClass} onClick={() => remove(v)}>
                            {b.delete}
                          </button>
                        </div>
                        {previewing === v.id && <video src={`/api/broadcast-videos/${v.id}/media`} controls preload="metadata" className="w-full max-w-2xl rounded-lg bg-black" />}
                        {editing?.id === v.id && (
                          <div className="space-y-3 rounded-lg bg-card/50 p-3">
                            <VideoFields value={editing.details} onChange={(details) => setEditing({ id: v.id, details })} tracks={tracks} cars={cars} showTitle />
                            <button
                              type="button"
                              className={primaryClass}
                              onClick={async () => {
                                if (await patch(v.id, payloadOf(editing.details))) setEditing(null);
                              }}
                            >
                              {b.save}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
