/* ============================================================================
   household.js — pure logic for multi-household support.

   Two different kinds of identifier are involved, and they're deliberately
   NOT the same thing:

   - A household's ID is long, random, and never meant to be typed by a
     human — it's the actual Firestore path every document lives under.
     It never changes once a household exists.
   - The invite CODE is short and human-typable, and it's just a pointer TO
     a household ID. Because it's a separate, disposable layer, it can be
     rotated freely without touching the household or anything inside it.

   Password hashing uses PBKDF2 via the browser's built-in Web Crypto API —
   no library needed, and it's the right tool for turning a password into
   something safe to store, rather than a single fast hash that's cheap to
   brute-force if someone ever gets read access to it.
   ========================================================================== */

const encoder = new TextEncoder();

/* ---------------------------------------------------------------------------
   IDS & CODES
   ------------------------------------------------------------------------ */

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A household's real ID — long, random, not meant for human eyes. */
export function generateHouseholdId() {
  return randomHex(16);
}

// Excludes 0/O and 1/I/L — characters easily confused when read aloud or
// typed from a photo of a screen.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A short, human-typable invite code. */
export function generateInviteCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Normalizes user-typed codes: case and stray whitespace shouldn't matter. */
export function normalizeCode(code) {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** The full shareable join link for a code, based on the current page. */
export function buildJoinLink(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', code);
  return url.toString();
}

/* ---------------------------------------------------------------------------
   PASSWORD HASHING (PBKDF2 via Web Crypto — no library needed)
   ------------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 150000;

export function randomSalt() {
  return randomHex(16);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/** Derives a hash from a password + salt. Same input always gives the same
 *  output, which is exactly what makes it useful for later verification —
 *  but it's slow and salted, which is what makes it safe to store. */
export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds a fresh { salt, hash } pair for a new or changed password. */
export async function makePasswordRecord(password) {
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  return { ownerPasswordSalt: salt, ownerPasswordHash: hash };
}

/** Whether a typed password matches a previously stored salt+hash. */
export async function verifyPassword(password, saltHex, expectedHash) {
  if (!saltHex || !expectedHash) return false;
  const hash = await hashPassword(password, saltHex);
  return hash === expectedHash;
}
