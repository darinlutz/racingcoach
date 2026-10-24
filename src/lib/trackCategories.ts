// "Tracks".track_category values, in the Track Type radio buttons' order (Track Data, and the Coach page's
// Track and Focus Area Maintenance). Types not listed here follow, alphabetically
export const TRACK_CATEGORIES = ['Road Course', 'Oval', 'Dirt'];
export const DEFAULT_TRACK_CATEGORY = 'Road Course';

export const trackCategoryRank = (category: string) => {
  const i = TRACK_CATEGORIES.indexOf(category);
  return i === -1 ? TRACK_CATEGORIES.length : i;
};

// The radio buttons for these tracks' types; the default always has one
export const trackCategoriesOf = (tracks: { category: string | null }[]) =>
  [...new Set([DEFAULT_TRACK_CATEGORY, ...tracks.flatMap((track) => (track.category ? [track.category] : []))])].sort(
    (a, b) => trackCategoryRank(a) - trackCategoryRank(b) || a.localeCompare(b)
  );
