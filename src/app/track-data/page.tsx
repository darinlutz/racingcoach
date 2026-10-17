import { redirect } from 'next/navigation';

// Track Data moved to the Cars & Tracks page's Tracks tab; old links and bookmarks land there
export default function TrackDataPage() {
  redirect('/cars-tracks?tab=tracks');
}
