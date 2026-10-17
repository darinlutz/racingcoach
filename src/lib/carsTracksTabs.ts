// The Cars & Tracks page's tabs, in order (also the values of its ?tab= parameter)
export const CARS_TRACKS_TABS = ['cars', 'tracks', 'racecar'] as const;
export type CarsTracksTab = (typeof CARS_TRACKS_TABS)[number];
