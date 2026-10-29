// TV Broadcast Mode's pairing codes (src/lib/tvAuth.ts): what the TV shows and the user types on their phone or
// computer. 8 characters from an alphabet without look-alikes (no 0/O/Q, 1/I/L, 2/Z, 5/S), shown as two groups of
// four, "K7PR-4MXT"; typed codes ignore case, spaces and dashes. No imports, so Node runs it directly
// (npm run test:tv).

export const PAIRING_ALPHABET = '346789ABCDEFGHJKMNPRTUVWXY';
export const PAIRING_CODE_LENGTH = 8;

// A random code from random bytes (crypto.randomBytes on the server); rejection sampling keeps each character uniform
export function pairingCodeFrom(randomByte: () => number): string {
  const limit = 256 - (256 % PAIRING_ALPHABET.length);
  let code = '';
  while (code.length < PAIRING_CODE_LENGTH) {
    const byte = randomByte();
    if (byte < limit) code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  }
  return code;
}

// "K7PR4MXT" -> "K7PR-4MXT", for the TV screen
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// What the user typed, as a code to look up, or null when it can't be one
export function normalizePairingCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  return [...code].every((c) => PAIRING_ALPHABET.includes(c)) ? code : null;
}
