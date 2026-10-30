// The Broadcast Video Library's eight categories, by stable identifier (src/lib/broadcastVideos.ts stores these, and the
// database's CHECK allows only these). Labels are in the dictionaries (admin.broadcast.categories, tv.director.cameras).
// No imports, so client components and Node's tests use it directly.

export const VIDEO_CATEGORIES = ['RACE_START', 'CRASHES', 'ONBOARDS', 'HELICOPTER', 'BLIMP', 'TVCAMERA1', 'TVCAMERA2', 'TVCAMERA3'] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const isVideoCategory = (value: unknown): value is VideoCategory => VIDEO_CATEGORIES.includes(value as VideoCategory);

// What a clip of each category can be assumed to show, for the announcers; only the clip's own metadata says more
export const CATEGORY_FACTS: Record<VideoCategory, string> = {
  RACE_START: 'recorded footage of a race start, from an earlier session',
  CRASHES: 'recorded footage of racing incidents, from an earlier session, not from this race',
  ONBOARDS: 'recorded in-car onboard camera footage',
  HELICOPTER: 'recorded aerial footage, as from a helicopter camera',
  BLIMP: 'recorded high-altitude aerial footage, as from a blimp camera',
  TVCAMERA1: 'recorded footage from a trackside camera',
  TVCAMERA2: 'recorded footage from a trackside camera',
  TVCAMERA3: 'recorded footage from a trackside camera',
};

// What the Admin page's uploads may be; anything but H.264 with AAC (or no audio) in an MP4 is transcoded
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export function hasVideoExtension(fileName: string): boolean {
  if (!fileName.includes('.')) return false;
  const extension = fileName.split('.').pop()?.toLowerCase();
  return VIDEO_EXTENSIONS.includes(extension as (typeof VIDEO_EXTENSIONS)[number]);
}
