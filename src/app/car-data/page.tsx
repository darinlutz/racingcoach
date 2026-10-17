import { redirect } from 'next/navigation';

// Car Data moved to the Cars & Tracks page's Cars tab; old links and bookmarks land there
export default function CarDataPage() {
  redirect('/cars-tracks?tab=cars');
}
