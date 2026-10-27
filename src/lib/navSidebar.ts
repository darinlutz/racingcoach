// The large-screen nav sidebar can be collapsed to icons. The choice is kept in this cookie so the root layout
// renders the page at the right width from the start; it puts data-nav="collapsed" on <html>, and globals.css
// sets --nav-width from it.

export const NAV_COOKIE = 'nav';
export const NAV_COLLAPSED = 'collapsed';
