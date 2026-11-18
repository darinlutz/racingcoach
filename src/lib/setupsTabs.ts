// The Setups page's tabs, in order (?tab= picks one). Its own module so the server page and the client tabs share it
export const SETUPS_TABS = ['overview', 'library', 'live', 'compare', 'suspension', 'brakes', 'tires', 'aero', 'drivetrain', 'fuel', 'electronics', 'other', 'engineer', 'inspection', 'history'] as const;
export type SetupsTab = (typeof SETUPS_TABS)[number];
