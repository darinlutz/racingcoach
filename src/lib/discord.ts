import { isUniqueViolation, query } from './db';
import { getSiteOrigin } from './siteOrigin';
import { ensureUserSchema } from './users';

// Links a user's Discord account with Discord OAuth2 (https://discord.com/developers/docs/topics/oauth2).
// The identify scope only reveals who they are on Discord; the access token is used once to read
// their profile and then revoked, so racingcoach."DiscordConnections" holds no tokens.

const DISCORD_API = 'https://discord.com/api/v10';

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
    super('That Discord account is already linked to another Clarivex account');
  }
}

export function discordConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Must match a Redirect URI on the Discord application's OAuth2 page exactly. SITE_URL pins it to
// the real domain in production.
export function discordRedirectUri(request: Request): string {
  return `${process.env.SITE_URL || getSiteOrigin(request)}/api/discord/callback`;
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

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...credentials, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  }
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  try {
    const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw new Error(`Discord profile lookup failed: ${userResponse.status}`);
    return (await userResponse.json()) as DiscordUser;
  } finally {
    // Not needed after this; revoking it is best effort
    await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
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

export async function deleteDiscordConnection(userId: number): Promise<void> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."DiscordConnections" WHERE user_id = $1', [userId]);
}
