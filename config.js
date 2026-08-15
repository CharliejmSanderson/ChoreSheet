/* ============================================================================
   config.js — the only file you need to edit to get this running.

   Paste your Firebase project's web config below. Step-by-step instructions for
   finding these values are in README.md (Setup, step 2).

   Until you do, the app runs in LOCAL PREVIEW mode: everything works, but the
   data lives only in the browser you're using and won't sync to anyone else.
   That's handy for having a look around before setting Firebase up.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: 'PASTE_YOUR_API_KEY_HERE',
  authDomain: 'PASTE_YOUR_AUTH_DOMAIN_HERE',
  projectId: 'PASTE_YOUR_PROJECT_ID_HERE',
  storageBucket: 'PASTE_YOUR_STORAGE_BUCKET_HERE',
  messagingSenderId: 'PASTE_YOUR_SENDER_ID_HERE',
  appId: 'PASTE_YOUR_APP_ID_HERE',
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
