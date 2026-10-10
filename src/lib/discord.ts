import { isUniqueViolation, query } from './db';
import { getPublicSiteUrl } from './siteOrigin';
import { ensureUserSchema } from './users';

// Links a user's Discord account with Discord OAuth2 (https://discord.com/developers/docs/topics/oauth2).
// The identify scope only reveals who they are on Discord; the access token is used once to read
// their profile and then revoked, so racingcoach."DiscordConnections" holds no tokens.

const DISCORD_API = 'https://discord.com/api/v10';

// The RacingCoach Discord server. Users are sent here once their account is linked.
export const DISCORD_INVITE_URL = 'https://discord.com/invite/gdYvmNefy';

// Holds the OAuth2 state between /api/discord/connect and /api/discord/callback
export const DISCORD_STATE_COOKIE = 'discord_oauth_state';

export type DiscordConnection = {
  discordUserId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

export class DiscordAlreadyLinkedError extends Error {
  constructor() {
    super('That Discord account is already linked to another RacingCoach account');
  }
}

// Discord's Cloudflare protection answers 429 when it has temporarily banned the server's IP address
// (Render shares outbound IPs between many apps, some of them busy Discord bots)
export class DiscordBlockedError extends Error {
  constructor(step: string) {
    super(`Discord temporarily blocked the ${step} request (429)`);
  }
}

// Calls the Discord API directly, or through the Cloudflare Worker in discord-proxy/ when
// DISCORD_PROXY_URL is set, so the requests come from Cloudflare's IP addresses instead of Render's.
// The Worker only forwards requests carrying DISCORD_PROXY_SECRET.
async function discordFetch(path: string, step: string, init: RequestInit): Promise<Response> {
  const proxyUrl = process.env.DISCORD_PROXY_URL?.trim().replace(/\/+$/, '');
  const proxySecret = process.env.DISCORD_PROXY_SECRET?.trim();
  if (proxyUrl && !proxySecret) throw new Error('DISCORD_PROXY_URL is set but DISCORD_PROXY_SECRET is not');
  const headers = new Headers(init.headers);
  if (proxyUrl) headers.set('X-Proxy-Secret', proxySecret as string);
  const response = await fetch(`${proxyUrl ? `${proxyUrl}/api/v10` : DISCORD_API}${path}`, { ...init, headers });
  if (response.status === 429) throw new DiscordBlockedError(step);
  return response;
}

export function discordConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Must match a Redirect URI on the Discord application's OAuth2 page exactly
export function discordRedirectUri(request: Request): string {
  return `${getPublicSiteUrl(request)}/api/discord/callback`;
}

export function discordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify',
    redirect_uri: redirectUri,
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null };

// Trades the authorization code for the user's Discord profile
export async function fetchDiscordUser(code: string, redirectUri: string): Promise<DiscordUser> {
  const config = discordConfig();
  if (!config) throw new Error('Discord is not configured');
  const credentials = { client_id: config.clientId, client_secret: config.clientSecret };

  const tokenResponse = await discordFetch('/oauth2/token', 'token exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...credentials, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) {
    // Discord's JSON error is short; an HTML error page is not worth logging whole
    const detail = (await tokenResponse.text()).slice(0, 300);
    throw new Error(`Discord token exchange failed: ${tokenResponse.status} ${detail}`);
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  try {
    const userResponse = await discordFetch('/users/@me', 'profile lookup', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw new Error(`Discord profile lookup failed: ${userResponse.status}`);
    return (await userResponse.json()) as DiscordUser;
  } finally {
    // Not needed after this; revoking it is best effort
    await discordFetch('/oauth2/token/revoke', 'token revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...credentials, token: accessToken, token_type_hint: 'access_token' }),
    }).catch(() => {});
  }
}

// Replaces any Discord account the user had linked before
export async function saveDiscordConnection(userId: number, discordUser: DiscordUser): Promise<void> {
  await ensureUserSchema();
  try {
    await query(
      `INSERT INTO racingcoach."DiscordConnections" (user_id, discord_user_id, discord_username, discord_global_name, discord_avatar)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET discord_user_id = EXCLUDED.discord_user_id,
         discord_username = EXCLUDED.discord_username, discord_global_name = EXCLUDED.discord_global_name,
         discord_avatar = EXCLUDED.discord_avatar, connected_at = now()`,
      [userId, discordUser.id, discordUser.username, discordUser.global_name, discordUser.avatar]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DiscordAlreadyLinkedError();
    throw error;
  }
}

export async function getDiscordConnection(userId: number): Promise<DiscordConnection | null> {
  await ensureUserSchema();
  const [row] = await query(
    `SELECT discord_user_id, discord_username, discord_global_name, discord_avatar, connected_at
     FROM racingcoach."DiscordConnections" WHERE user_id = $1`,
    [userId]
  );
  if (!row) return null;
  const discordUserId = row.discord_user_id as string;
  const avatar = row.discord_avatar as string | null;
  return {
    discordUserId,
    username: row.discord_username as string,
    globalName: row.discord_global_name as string | null,
    avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.png?size=64` : null,
    connectedAt: (row.connected_at as Date).toISOString(),
  };
}

// The RacingCoach user a Discord account is linked to, for the Discord bot
export async function getUserIdByDiscordId(discordUserId: string): Promise<number | null> {
  await ensureUserSchema();
  const [row] = await query('SELECT user_id FROM racingcoach."DiscordConnections" WHERE discord_user_id = $1', [
    discordUserId,
  ]);
  return row ? (row.user_id as number) : null;
}

export async function deleteDiscordConnection(userId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."DiscordConnections" WHERE user_id = $1', [userId]);
}
