/* ============================================================================
   store.js — everything that reads or writes data.

   The rest of the app never touches Firebase directly; it calls the functions
   here. That keeps the Firebase-specific bits in one place, and lets the app
   fall back to browser storage when Firebase isn't configured yet.

   Collections:
     familyMembers  people
     chores         the chore library (name, weight, weekly/daily)
     weeks          one document per generated week, keyed by its Monday
     activityLog    an append-only record of every change anyone makes
   ========================================================================== */

import { firebaseConfig, isConfigured, FIREBASE_VERSION } from './config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const LOCAL_KEY = 'chores:local-data';
const WHO_KEY = 'chores:who';

/** 'cloud' once Firebase is talking, 'local' while previewing on one device. */
export let mode = 'local';

/** Live in-memory copy of everything. Views read from this. */
export const data = {
  members: [],
  chores: [],
  weeks: [],
  log: [],
};

let fb = null;               // holds the Firestore functions once loaded
let db = null;
const subscribers = new Set();

/** Register a callback to re-render whenever data changes. */
export function onChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify() {
  for (const fn of subscribers) fn();
}

/* ---------------------------------------------------------------------------
   WHO AM I

   There's no login. People pick their name once and it's remembered on that
   device. This is what gets stamped on activity log entries.
   ------------------------------------------------------------------------ */

export function getWho() {
  try { return localStorage.getItem(WHO_KEY) || null; } catch { return null; }
}

export function setWho(memberId) {
  try {
    if (memberId) localStorage.setItem(WHO_KEY, memberId);
    else localStorage.removeItem(WHO_KEY);
  } catch { /* private browsing — not worth failing over */ }
  notify();
}

export function whoName() {
  const id = getWho();
  return data.members.find((m) => m.id === id)?.name || 'Someone';
}

/* ---------------------------------------------------------------------------
   LOCAL FALLBACK
   ------------------------------------------------------------------------ */

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      members: data.members, chores: data.chores, weeks: data.weeks, log: data.log,
    }));
  } catch { /* storage full or blocked; the session still works in memory */ }
}

function localId() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------------------
   STARTUP
   ------------------------------------------------------------------------ */

export async function initStore() {
  if (!isConfigured()) {
    mode = 'local';
    const saved = readLocal();
    if (saved) Object.assign(data, saved);
    else seedStarterData();
    notify();
    return mode;
  }

  try {
    const appMod = await import(`${CDN}/firebase-app.js`);
    const fsMod = await import(`${CDN}/firebase-firestore.js`);
    const app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);
    fb = fsMod;
    mode = 'cloud';

    // Live listeners: any change made by anyone, on any phone, lands here and
    // triggers a re-render. No refresh button needed.
    watch('familyMembers', 'members');
    watch('chores', 'chores');
    watch('weeks', 'weeks');
    watchLog();
    return mode;
  } catch (err) {
    console.error('Could not reach Firebase, staying in local preview.', err);
    mode = 'local';
    const saved = readLocal();
    if (saved) Object.assign(data, saved); else seedStarterData();
    notify();
    return mode;
  }
}

function watch(collectionName, key) {
  fb.onSnapshot(fb.collection(db, collectionName), (snap) => {
    data[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (key === 'weeks') data.weeks.sort((a, b) => (a.id < b.id ? 1 : -1));
    notify();
  }, (err) => console.error(`Lost the ${collectionName} connection.`, err));
}

function watchLog() {
  const q = fb.query(
    fb.collection(db, 'activityLog'),
    fb.orderBy('timestamp', 'desc'),
    fb.limit(150)
  );
  fb.onSnapshot(q, (snap) => {
    data.log = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    notify();
  }, (err) => console.error('Lost the activity log connection.', err));
}

/** A first-run example family so the app isn't a blank wall. Easy to delete. */
function seedStarterData() {
  data.members = [
    { id: localId(), name: 'Add your family', active: true, ageRestricted: false },
  ];
  data.chores = [
    { id: localId(), name: 'Load the dishwasher', weight: 1, frequency: 'daily', adultOnly: false, active: true },
    { id: localId(), name: 'Walk the dog', weight: 3, frequency: 'daily', adultOnly: false, active: true },
    { id: localId(), name: 'Clean the bathroom', weight: 4, frequency: 'weekly', adultOnly: false, active: true },
    { id: localId(), name: 'Bins out', weight: 1, frequency: 'weekly', adultOnly: false, active: true },
  ];
  data.weeks = [];
  data.log = [];
  writeLocal();
}

/* ---------------------------------------------------------------------------
   WRITES

   Each of these mirrors the change into the in-memory cache in local mode. In
   cloud mode the snapshot listener does that for us, so we just write.
   ------------------------------------------------------------------------ */

async function create(collectionName, key, payload) {
  if (mode === 'cloud') {
    const ref = await fb.addDoc(fb.collection(db, collectionName), payload);
    return ref.id;
  }
  const id = localId();
  data[key].push({ id, ...payload });
  writeLocal();
  notify();
  return id;
}

async function update(collectionName, key, id, patch) {
  if (mode === 'cloud') {
    await fb.updateDoc(fb.doc(db, collectionName, id), patch);
    return;
  }
  const item = data[key].find((x) => x.id === id);
  if (item) Object.assign(item, patch);
  writeLocal();
  notify();
}

async function remove(collectionName, key, id) {
  if (mode === 'cloud') {
    await fb.deleteDoc(fb.doc(db, collectionName, id));
    return;
  }
  data[key] = data[key].filter((x) => x.id !== id);
  writeLocal();
  notify();
}

/* Members ---------------------------------------------------------------- */

export const addMember = (name) =>
  create('familyMembers', 'members', {
    name: name.trim(), active: true, ageRestricted: false,
  });

export const updateMember = (id, patch) => update('familyMembers', 'members', id, patch);
export const removeMember = (id) => remove('familyMembers', 'members', id);

/* Chores ----------------------------------------------------------------- */

export const addChore = (chore) =>
  create('chores', 'chores', {
    name: chore.name.trim(),
    weight: Number(chore.weight) || 1,
    frequency: chore.frequency === 'daily' ? 'daily' : 'weekly',
    adultOnly: !!chore.adultOnly,
    active: true,
  });

export const updateChore = (id, patch) => update('chores', 'chores', id, patch);
export const removeChore = (id) => remove('chores', 'chores', id);

/* Weeks ------------------------------------------------------------------ */

/** Weeks use their Monday date as the document ID, so a week can never be
 *  generated twice by two people pressing the button at the same time. */
export async function saveWeek(week) {
  if (mode === 'cloud') {
    const { id, ...body } = week;
    await fb.setDoc(fb.doc(db, 'weeks', id), body);
    return;
  }
  const existing = data.weeks.findIndex((w) => w.id === week.id);
  if (existing >= 0) data.weeks[existing] = week;
  else data.weeks.push(week);
  data.weeks.sort((a, b) => (a.id < b.id ? 1 : -1));
  writeLocal();
  notify();
}

export async function updateWeekAssignments(weekId, assignments) {
  if (mode === 'cloud') {
    await fb.updateDoc(fb.doc(db, 'weeks', weekId), { assignments });
    return;
  }
  const week = data.weeks.find((w) => w.id === weekId);
  if (week) week.assignments = assignments;
  writeLocal();
  notify();
}

export async function removeWeek(weekId) {
  return remove('weeks', 'weeks', weekId);
}

export const getWeek = (weekId) => data.weeks.find((w) => w.id === weekId) || null;

/* Activity log ------------------------------------------------------------ */

/**
 * Record a change. Everything that alters shared state should call this —
 * it's the only thing standing in for permissions, so it needs to be complete.
 */
export async function logActivity({ action, before = null, after = null, context = '', weekId = null }) {
  const entry = {
    timestamp: new Date().toISOString(),
    personName: whoName(),
    action,
    details: { before, after, context },
    weekId,
  };

  if (mode === 'cloud') {
    await fb.addDoc(fb.collection(db, 'activityLog'), entry);
    return;
  }
  data.log.unshift({ id: localId(), ...entry });
  data.log = data.log.slice(0, 150);
  writeLocal();
  notify();
}

/** Wipe local preview data (cloud data is never touched by this). */
export function resetLocal() {
  try { localStorage.removeItem(LOCAL_KEY); } catch {}
  seedStarterData();
  notify();
}
