import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// Where the agent keeps things on the Mac, its log, and its secrets (docs/lighting/MAC_INSTALL.md):
//   ~/Library/Application Support/RacingCoachLighting/   config.json (the installation), state.json (mode, scene,
//                                                        manual changes), local-token (the local API's token, 0600)
//   ~/Library/Logs/RacingCoachLighting/agent.log         JSON lines, rotated at LOG_MAX_BYTES, LOG_KEEP kept
//   the login Keychain, service app.racingcoach.lighting  the device token from pairing
// RC_LIGHTING_HOME puts everything in one folder instead (development and tests, and other systems than macOS).

const SERVICE = 'app.racingcoach.lighting';
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_KEEP = 5;

export const isMac = platform() === 'darwin';

export function homeDir(): string {
  const dir = process.env.RC_LIGHTING_HOME ?? (isMac ? join(homedir(), 'Library', 'Application Support', 'RacingCoachLighting') : join(homedir(), '.racingcoach-lighting'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function logDir(): string {
  const dir = process.env.RC_LIGHTING_HOME ? join(process.env.RC_LIGHTING_HOME, 'logs') : isMac ? join(homedir(), 'Library', 'Logs', 'RacingCoachLighting') : join(homeDir(), 'logs');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function writePrivate(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // not on every file system
  }
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// ---- The local API's token: made once, readable only by this macOS account, never in a Stream Deck button ----

export function localToken(): string {
  const path = join(homeDir(), 'local-token');
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{32,}$/.test(token)) return token;
  }
  const token = randomBytes(32).toString('base64url');
  writePrivate(path, token);
  return token;
}

// ---- The log: JSON lines with secrets taken out, rotated by size ----

const SECRET = /\b(rc(?:lp|ld|la)_[A-Za-z0-9_-]{8,})|(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;
export const redact = (text: string) => text.replace(SECRET, (_m, tok, bearer) => (tok ? `${tok.slice(0, 5)}…` : `${bearer}…`));

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function makeLogger(echo = true) {
  const file = join(logDir(), 'agent.log');
  const rotate = () => {
    try {
      if (!existsSync(file) || statSync(file).size < LOG_MAX_BYTES) return;
      rmSync(`${file}.${LOG_KEEP}`, { force: true });
      for (let i = LOG_KEEP - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      renameSync(file, `${file}.1`);
    } catch {
      // a failed rotation never stops the agent
    }
  };
  let lines = 0;
  return (level: LogLevel, message: string, detail?: Record<string, unknown>) => {
    const line = redact(JSON.stringify({ at: new Date().toISOString(), level, message, ...(detail ? { detail } : {}) }));
    if (++lines % 200 === 0) rotate();
    try {
      appendFileSync(file, `${line}\n`, { mode: 0o600 });
    } catch {
      // nor does a full disk
    }
    if (echo && level !== 'debug') (level === 'error' ? console.error : console.log)(redact(`[${level}] ${message}${detail ? ` ${JSON.stringify(detail)}` : ''}`));
  };
}
export type Logger = ReturnType<typeof makeLogger>;

// ---- The device token: in the macOS login Keychain; elsewhere a 0600 file (development only) ----

function run(command: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

// The token goes to `security` on its standard input (its interactive mode), so it's never in a process list
export async function saveDeviceToken(token: string): Promise<void> {
  if (!/^rcld_[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error('Not a device token');
  if (!isMac) return writePrivate(join(homeDir(), 'device-token'), token);
  const result = await run('/usr/bin/security', ['-i'], `add-generic-password -U -s ${SERVICE} -a device-token -w ${token}\n`);
  if (result.code !== 0) throw new Error(`Keychain: ${result.stderr.trim() || 'could not save'}`);
}

export async function readDeviceToken(): Promise<string | null> {
  if (!isMac) {
    const path = join(homeDir(), 'device-token');
    return existsSync(path) ? readFileSync(path, 'utf8').trim() || null : null;
  }
  const result = await run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', 'device-token', '-w']);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

export async function deleteDeviceToken(): Promise<void> {
  if (!isMac) return rmSync(join(homeDir(), 'device-token'), { force: true });
  await run('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', 'device-token']);
}
