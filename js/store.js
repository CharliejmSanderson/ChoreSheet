/* ============================================================================
   store.js — everything that reads or writes data.

   The rest of the app never touches Firebase directly; it calls the functions
   here. That keeps the Firebase-specific bits in one place, and lets the app
   fall back to browser storage when Firebase isn't configured yet.

   HOUSEHOLDS

   Every family's data lives under households/{householdId}/... — a household
   ID is long, random, and never meant to be typed by a human; it's just the
   Firestore path everything lives under. The short, human-typable invite
   CODE is a separate, disposable pointer to that ID (see household.js), which
   is what makes it possible to rotate the code without touching anything it
   points to.

   Local preview mode (no Firebase configured) skips the household concept
   entirely — it's one device, nothing to share, so there's nothing to gate.

   Collections, all nested under a household:
     familyMembers  people
     chores         the chore library (name, note, weekly/daily)
     weeks          one document per generated week, keyed by its Monday
     activityLog    an append-only record of every change anyone makes
     infoBlocks     Tasks > Info content: notes, checklists, steps, etc.
     appMeta        small standalone values — currently just infoBoxOrder

   Two more collections live OUTSIDE any household, at the top level:
     households/{id}     the household's own record — invite code, owner
                          password hash+salt, createdAt
     inviteCodes/{code}  a short code -> { householdId } lookup
   ========================================================================== */

import { firebaseConfig, isConfigured, FIREBASE_VERSION } from './config.js';
import {
  generateHouseholdId, generateInviteCode, normalizeCode,
  makePasswordRecord, verifyPassword,
} from './household.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const LOCAL_KEY = 'chores:local-data';
const WHO_KEY = 'chores:who';
const HOUSEHOLD_KEY = 'chores:householdId';
const OWNER_KEY_PREFIX = 'chores:owner:';

/** 'cloud' once Firebase is talking, 'local' while previewing on one device. */
export let mode = 'local';

/** Live in-memory copy of everything. Views read from this. */
export const data = {
  members: [],
  chores: [],
  weeks: [],
  log: [],
  infoBlocks: [],
  infoBoxOrder: [], // chore IDs, in the order their Info boxes should appear

  householdId: null,   // this device's current household, once resolved
  household: null,     // { id, inviteCode, ownerPasswordHash, ownerPasswordSalt, createdAt }
  isOwner: false,       // whether THIS device is recognized as the owner
  hasLegacyData: false, // true if pre-household top-level data was found
};

let fb = null;               // holds the Firestore functions once loaded
let db = null;
const subscribers = new Set();
let activeUnsubscribes = []; // live listeners for whichever household is open

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
   LOCAL FALLBACK (preview mode only — no households involved)
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
      infoBlocks: data.infoBlocks, infoBoxOrder: data.infoBoxOrder,
    }));
  } catch { /* storage full or blocked; the session still works in memory */ }
}

function localId() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------------------
   HOUSEHOLD LOCAL STORAGE — which household this device belongs to, and
   whether it's recognized as that household's owner.
   ------------------------------------------------------------------------ */

function getSavedHouseholdId() {
  try { return localStorage.getItem(HOUSEHOLD_KEY) || null; } catch { return null; }
}

function saveHouseholdLocally(id) {
  try { localStorage.setItem(HOUSEHOLD_KEY, id); } catch {}
}

function clearSavedHousehold() {
  try { localStorage.removeItem(HOUSEHOLD_KEY); } catch {}
}

function getSavedOwnerFlag(id) {
  try { return localStorage.getItem(OWNER_KEY_PREFIX + id) === '1'; } catch { return false; }
}

function setOwnerFlag(id, isOwner) {
  try {
    if (isOwner) localStorage.setItem(OWNER_KEY_PREFIX + id, '1');
    else localStorage.removeItem(OWNER_KEY_PREFIX + id);
  } catch {}
}

/* ---------------------------------------------------------------------------
   STARTUP

   Returns one of:
     'ready'            data is loaded and being watched — show the app
     'needs-household'  Firebase is connected but this device isn't in a
                         household yet — show the create/join gate
   ------------------------------------------------------------------------ */

export async function initStore() {
  if (!isConfigured()) {
    mode = 'local';
    const saved = readLocal();
    if (saved) Object.assign(data, saved);
    else seedStarterData();
    notify();
    return 'ready'; // local preview never needs the household gate
  }

  try {
    const appMod = await import(`${CDN}/firebase-app.js`);
    const fsMod = await import(`${CDN}/firebase-firestore.js`);
    const app = appMod.initializeApp(firebaseConfig);
    db = fsMod.getFirestore(app);
    fb = fsMod;
    mode = 'cloud';
  } catch (err) {
    console.error('Could not reach Firebase, staying in local preview.', err);
    mode = 'local';
    const saved = readLocal();
    if (saved) Object.assign(data, saved); else seedStarterData();
    notify();
    return 'ready';
  }

  const savedHouseholdId = getSavedHouseholdId();
  if (savedHouseholdId) {
    const loaded = await loadHousehold(savedHouseholdId);
    if (loaded) {
      startHouseholdWatchers();
      return 'ready';
    }
    // The saved ID no longer resolves to a real household (deleted, or a
    // stale value from testing) — don't get stuck, just ask again.
    clearSavedHousehold();
  }

  data.hasLegacyData = await checkLegacyData();
  notify();
  return 'needs-household';
}

async function loadHousehold(householdId) {
  try {
    const snap = await fb.getDoc(fb.doc(db, 'households', householdId));
    if (!snap.exists()) return false;
    data.householdId = householdId;
    data.household = { id: householdId, ...snap.data() };
    data.isOwner = getSavedOwnerFlag(householdId);
    return true;
  } catch (err) {
    console.error('Could not load that household.', err);
    return false;
  }
}

/** Any pre-household data sitting at the old top-level paths? Used to offer
 *  "set up my existing family" as a third option alongside create/join. */
async function checkLegacyData() {
  try {
    const snap = await fb.getDocs(fb.query(fb.collection(db, 'chores'), fb.limit(1)));
    return !snap.empty;
  } catch {
    return false;
  }
}

function col(name) {
  return fb.collection(db, 'households', data.householdId, name);
}

function docRef(name, id) {
  return fb.doc(db, 'households', data.householdId, name, id);
}

function startHouseholdWatchers() {
  stopHouseholdWatchers();
  watch('familyMembers', 'members');
  watch('chores', 'chores');
  watch('weeks', 'weeks');
  watch('infoBlocks', 'infoBlocks');
  watchLog();
  watchInfoBoxOrder();
  watchHouseholdDoc();
}

function stopHouseholdWatchers() {
  for (const unsub of activeUnsubscribes) unsub();
  activeUnsubscribes = [];
}

function watch(collectionName, key) {
  const unsub = fb.onSnapshot(col(collectionName), (snap) => {
    data[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (key === 'weeks') data.weeks.sort((a, b) => (a.id < b.id ? 1 : -1));
    notify();
  }, (err) => console.error(`Lost the ${collectionName} connection.`, err));
  activeUnsubscribes.push(unsub);
}

function watchLog() {
  const q = fb.query(col('activityLog'), fb.orderBy('timestamp', 'desc'), fb.limit(150));
  const unsub = fb.onSnapshot(q, (snap) => {
    data.log = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    notify();
  }, (err) => console.error('Lost the activity log connection.', err));
  activeUnsubscribes.push(unsub);
}

/** infoBoxOrder is one small value, not a collection of many documents, so it
 *  gets its own single-document watcher rather than going through watch(). */
function watchInfoBoxOrder() {
  const unsub = fb.onSnapshot(docRef('appMeta', 'infoBoxOrder'), (snap) => {
    data.infoBoxOrder = snap.exists() ? (snap.data().order || []) : [];
    notify();
  }, (err) => console.error('Lost the info box order connection.', err));
  activeUnsubscribes.push(unsub);
}

/** Keeps data.household live — so if the owner rotates the code or changes
 *  the password from another device, this one picks it up automatically. */
function watchHouseholdDoc() {
  const unsub = fb.onSnapshot(fb.doc(db, 'households', data.householdId), (snap) => {
    if (snap.exists()) data.household = { id: data.householdId, ...snap.data() };
    notify();
  }, (err) => console.error('Lost the household connection.', err));
  activeUnsubscribes.push(unsub);
}

/** A first-run example family so the app isn't a blank wall. Easy to delete. */
function seedStarterData() {
  data.members = [
    { id: localId(), name: 'Add your family', active: true, ageRestricted: false },
  ];
  data.chores = [
    { id: localId(), name: 'Load the dishwasher', notes: '', frequency: 'daily', restriction: 'none', active: true },
    { id: localId(), name: 'Walk the dog', notes: 'Before 8am on school days', frequency: 'daily', restriction: 'none', active: true },
    { id: localId(), name: 'Clean the bathroom', notes: '', frequency: 'weekly', restriction: 'none', active: true },
    { id: localId(), name: 'Bins out', notes: 'Tuesday night at the latest', frequency: 'weekly', restriction: 'none', active: true },
  ];
  data.weeks = [];
  data.log = [];
  data.infoBlocks = [];
  data.infoBoxOrder = [];
  writeLocal();
}

/** The same starter chores, written into a brand-new household in the cloud,
 *  so creating a household feels the same as today's fresh install. */
async function seedHouseholdStarterData() {
  await addChore({ name: 'Load the dishwasher', notes: '', frequency: 'daily', restriction: 'none' });
  await addChore({ name: 'Walk the dog', notes: 'Before 8am on school days', frequency: 'daily', restriction: 'none' });
  await addChore({ name: 'Clean the bathroom', notes: '', frequency: 'weekly', restriction: 'none' });
  await addChore({ name: 'Bins out', notes: 'Tuesday night at the latest', frequency: 'weekly', restriction: 'none' });
}

/* ---------------------------------------------------------------------------
   HOUSEHOLDS — create, join, leave, and owner administration
   ------------------------------------------------------------------------ */

/** Creates a brand-new, empty household and makes this device its owner. */
export async function createHousehold(password) {
  stopHouseholdWatchers();

  const householdId = generateHouseholdId();
  const code = generateInviteCode();
  const { ownerPasswordSalt, ownerPasswordHash } = await makePasswordRecord(password);
  const householdDoc = { inviteCode: code, ownerPasswordSalt, ownerPasswordHash, createdAt: new Date().toISOString() };

  await fb.setDoc(fb.doc(db, 'households', householdId), householdDoc);
  await fb.setDoc(fb.doc(db, 'inviteCodes', code), { householdId });

  data.householdId = householdId;
  data.household = { id: householdId, ...householdDoc };
  data.isOwner = true;
  saveHouseholdLocally(householdId);
  setOwnerFlag(householdId, true);

  startHouseholdWatchers();
  await seedHouseholdStarterData();
  notify();
  return householdId;
}

/** Looks up which household a code currently points to, or null if the code
 *  doesn't exist (never existed, or was rotated away from). */
export async function resolveInviteCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  try {
    const snap = await fb.getDoc(fb.doc(db, 'inviteCodes', code));
    return snap.exists() ? snap.data().householdId : null;
  } catch (err) {
    console.error('Could not look up that code.', err);
    return null;
  }
}

/** Joins an existing household by ID (already resolved from a code). Joining
 *  never grants owner status — that always requires the password. */
export async function joinHousehold(householdId) {
  stopHouseholdWatchers();
  const loaded = await loadHousehold(householdId);
  if (!loaded) return false;

  data.isOwner = false;
  saveHouseholdLocally(householdId);
  setOwnerFlag(householdId, false);

  startHouseholdWatchers();
  notify();
  return true;
}

/** Checks a typed password against the current owner password. On success,
 *  this device is marked owner — this is the recovery path for a new
 *  device, or one that's lost its local owner flag. */
export async function verifyOwnerPassword(password) {
  if (!data.household) return false;
  const ok = await verifyPassword(password, data.household.ownerPasswordSalt, data.household.ownerPasswordHash);
  if (ok) {
    setOwnerFlag(data.householdId, true);
    data.isOwner = true;
    notify();
  }
  return ok;
}

/** Rotates the invite code — the old one stops working immediately. */
export async function rotateInviteCode() {
  const newCode = generateInviteCode();
  const oldCode = data.household?.inviteCode;

  await fb.setDoc(fb.doc(db, 'households', data.householdId), { inviteCode: newCode }, { merge: true });
  await fb.setDoc(fb.doc(db, 'inviteCodes', newCode), { householdId: data.householdId });
  if (oldCode) {
    try { await fb.deleteDoc(fb.doc(db, 'inviteCodes', oldCode)); } catch { /* best-effort cleanup */ }
  }

  data.household.inviteCode = newCode;
  notify();
  return newCode;
}

/** Changes the owner password. The device calling this is already trusted
 *  (it's showing owner controls), so this doesn't re-check the old one. */
export async function changeOwnerPassword(newPassword) {
  const record = await makePasswordRecord(newPassword);
  await fb.setDoc(fb.doc(db, 'households', data.householdId), record, { merge: true });
  Object.assign(data.household, record);
  notify();
}

/** Leaves the current household on this device — clears everything local
 *  and in memory, ready for the gate to ask create-or-join again. */
export function leaveHousehold() {
  stopHouseholdWatchers();
  if (data.householdId) setOwnerFlag(data.householdId, false);
  clearSavedHousehold();
  setWho(null);

  data.householdId = null;
  data.household = null;
  data.isOwner = false;
  data.members = [];
  data.chores = [];
  data.weeks = [];
  data.log = [];
  data.infoBlocks = [];
  data.infoBoxOrder = [];
  notify();
}

/**
 * One-time migration: copies pre-household data sitting at the old
 * top-level collection paths into a brand-new household, preserving every
 * document's original ID (chores, weeks, and info blocks all reference each
 * other by ID, so those references have to survive the move intact).
 *
 * Nothing at the old paths is deleted — they're just left unused afterward.
 * That's deliberate: if anything about this goes wrong, the original data
 * is still sitting there untouched.
 */
export async function migrateLegacyToHousehold(password) {
  stopHouseholdWatchers();

  const householdId = generateHouseholdId();
  const code = generateInviteCode();
  const { ownerPasswordSalt, ownerPasswordHash } = await makePasswordRecord(password);
  const householdDoc = { inviteCode: code, ownerPasswordSalt, ownerPasswordHash, createdAt: new Date().toISOString() };

  await fb.setDoc(fb.doc(db, 'households', householdId), householdDoc);
  await fb.setDoc(fb.doc(db, 'inviteCodes', code), { householdId });

  for (const name of ['familyMembers', 'chores', 'weeks', 'activityLog', 'infoBlocks']) {
    await copyLegacyCollection(name, householdId);
  }
  await copyLegacyInfoBoxOrder(householdId);

  data.householdId = householdId;
  data.household = { id: householdId, ...householdDoc };
  data.isOwner = true;
  saveHouseholdLocally(householdId);
  setOwnerFlag(householdId, true);

  startHouseholdWatchers();
  notify();
  return householdId;
}

async function copyLegacyCollection(name, householdId) {
  const snap = await fb.getDocs(fb.collection(db, name));
  const docs = snap.docs;

  // Firestore batches cap at 500 operations; chunk generously under that so
  // this holds up regardless of how much history has piled up (activityLog
  // especially — it's never pruned, so a long-running household could have
  // thousands of entries).
  for (let i = 0; i < docs.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const d of docs.slice(i, i + 400)) {
      batch.set(fb.doc(db, 'households', householdId, name, d.id), d.data());
    }
    await batch.commit();
  }
}

async function copyLegacyInfoBoxOrder(householdId) {
  const snap = await fb.getDoc(fb.doc(db, 'appMeta', 'infoBoxOrder'));
  if (snap.exists()) {
    await fb.setDoc(fb.doc(db, 'households', householdId, 'appMeta', 'infoBoxOrder'), snap.data());
  }
}

/* ---------------------------------------------------------------------------
   WRITES

   Each of these mirrors the change into the in-memory cache in local mode. In
   cloud mode the snapshot listener does that for us, so we just write.
   ------------------------------------------------------------------------ */

async function create(collectionName, key, payload) {
  if (mode === 'cloud') {
    const ref = await fb.addDoc(col(collectionName), payload);
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
    await fb.updateDoc(docRef(collectionName, id), patch);
    return;
  }
  const item = data[key].find((x) => x.id === id);
  if (item) Object.assign(item, patch);
  writeLocal();
  notify();
}

async function remove(collectionName, key, id) {
  if (mode === 'cloud') {
    await fb.deleteDoc(docRef(collectionName, id));
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
    notes: (chore.notes || '').trim(),
    frequency: chore.frequency === 'daily' ? 'daily' : 'weekly',
    restriction: chore.restriction || 'none', // 'none' | 'adultOnly' | 'childOnly'
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
    await fb.setDoc(docRef('weeks', id), body);
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
  return updateWeekFields(weekId, { assignments });
}

/** Restore more than just assignments in one write — used by "undo redraw",
 *  which needs to put back both the assignments and who was away. */
export async function updateWeekFields(weekId, patch) {
  if (mode === 'cloud') {
    await fb.updateDoc(docRef('weeks', weekId), patch);
    return;
  }
  const week = data.weeks.find((w) => w.id === weekId);
  if (week) Object.assign(week, patch);
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
    await fb.addDoc(col('activityLog'), entry);
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

/* ---------------------------------------------------------------------------
   INFO BLOCKS (Tasks > Info)

   A "box" — a chore with at least one block — isn't its own record; it's
   just whatever chore IDs currently have blocks. Adding a chore's first
   block appends it to infoBoxOrder; removing its last block drops it back
   out, matching "stays on the page once it has something in it."
   ------------------------------------------------------------------------ */

export async function addInfoBlock(payload) {
  const id = await create('infoBlocks', 'infoBlocks', payload);
  if (!data.infoBoxOrder.includes(payload.choreId)) {
    await setInfoBoxOrder([...data.infoBoxOrder, payload.choreId]);
  }
  return id;
}

export const updateInfoBlock = (id, patch) => update('infoBlocks', 'infoBlocks', id, patch);

export async function removeInfoBlock(id) {
  const block = data.infoBlocks.find((b) => b.id === id);
  await remove('infoBlocks', 'infoBlocks', id);

  // If that was the chore's last block, its box disappears from the order too.
  const stillHasBlocks = data.infoBlocks.some((b) => b.choreId === block?.choreId && b.id !== id);
  if (block && !stillHasBlocks && data.infoBoxOrder.includes(block.choreId)) {
    await setInfoBoxOrder(data.infoBoxOrder.filter((cid) => cid !== block.choreId));
  }
}

export async function setInfoBoxOrder(order) {
  if (mode === 'cloud') {
    await fb.setDoc(docRef('appMeta', 'infoBoxOrder'), { order });
    return;
  }
  data.infoBoxOrder = order;
  writeLocal();
  notify();
}

/** Renumber a set of blocks to a new order in one go — used when reordering
 *  the blocks within a single chore's box. */
export async function reorderInfoBlocks(orderedIds) {
  await Promise.all(orderedIds.map((id, index) => updateInfoBlock(id, { order: index })));
}
