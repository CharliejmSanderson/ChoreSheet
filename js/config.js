/* ============================================================================
   config.js — the only file you need to edit to get this running.

   Paste your Firebase project's web config below. Step-by-step instructions for
   finding these values are in README.md (Setup, step 2).

   Until you do, the app runs in LOCAL PREVIEW mode: everything works, but the
   data lives only in the browser you're using and won't sync to anyone else.
   That's handy for having a look around before setting Firebase up.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: "AIzaSyD3JCumXMnl51dwSVaRCvqv7n0z33-GjIA",
  authDomain: "chore-sheet-b70d5.firebaseapp.com",
  projectId: "chore-sheet-b70d5",
  storageBucket: "chore-sheet-b70d5.firebasestorage.app",
  messagingSenderId: "423085661594",
  appId: "1:423085661594:web:b2f94f61b828e7898c2e23",
};

/** True once the placeholders above have actually been replaced. */
export function isConfigured() {
  return !Object.values(firebaseConfig).some(
    (value) => typeof value !== 'string' || value.startsWith('PASTE_')
  );
}

/* Which Firebase SDK version to load from the CDN. Bumping this is usually
   safe; check Firebase's release notes if something stops working. */
export const FIREBASE_VERSION = '10.12.2';
