// The Setups page's tabs, in order (?tab= picks one). Its own module so the server page and the client tabs share it.
// carSetups (the iRacing Setups library) is for Admins only: the page leaves it out for anyone else
export const SETUPS_TABS = ['overview', 'library', 'carSetups', 'live', 'compare', 'alignment', 'suspension', 'brakes', 'tires', 'aero', 'drivetrain', 'fuel', 'electronics', 'other', 'engineer', 'inspection', 'history'] as const;
export type SetupsTab = (typeof SETUPS_TABS)[number];
