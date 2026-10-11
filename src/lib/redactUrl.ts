// Query parameters that carry secrets (password reset links, Stripe and Discord returns, API keys)
const SECRET_PARAMS = /^(token|code|state|session_id|key|api_?key|secret|password|access_token|refresh_token)$/i;

// The URL with any secret query parameter's value replaced by REDACTED, so it can be stored in the activity
// log. Relative URLs stay relative. Shared by the browser tracker and the server, which checks again.
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    let changed = false;
    for (const name of [...parsed.searchParams.keys()]) {
      if (SECRET_PARAMS.test(name)) {
        parsed.searchParams.set(name, 'REDACTED');
        changed = true;
      }
    }
    if (!changed) return url;
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
