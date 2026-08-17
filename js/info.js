/* ============================================================================
   info.js — pure logic for the Tasks tab's Info section.

   A "box" is a chore that has at least one info block attached to it. A
   "block" is one piece of content inside that box: a note, a checklist, an
   ordered step list, a comment thread, or a supply counter. This file only
   computes shapes and derived state — no DOM, no Firebase. store.js persists
   it, views.js renders it.

   HOW CHECKLIST RESETS WORK

   A checklist's ITEMS (their labels) are persistent, edited rarely — "Morning
   feed", "Evening feed" — same as a chore's name. Whether each item is
   currently TICKED is a different kind of data: it needs to reset on a
   schedule (daily, weekly, or never), because "fed at 7am" only means
   something for today.

   Rather than running a reset on a timer (there's no server to run one on),
   the reset happens lazily by comparison: every checklist block stores which
   PERIOD its current ticked state belongs to. When the block is read, if
   today's period doesn't match the stored one, the ticked state simply reads
   as empty — nothing has to be written until someone actually ticks
   something, at which point the write naturally moves the block into the new
   period. No cron, no cleanup job, no unbounded history.
   ========================================================================== */

import { toISODate, weekIdFor } from './schedule.js';

/* ---------------------------------------------------------------------------
   BLOCK TYPES
   ------------------------------------------------------------------------ */

export const BLOCK_TYPES = [
  {
    id: 'note',
    label: 'Note',
    description: 'Free text — instructions, reminders, anything worth writing down.',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    description: 'Tick off separate parts through the day or week. Resets on a schedule you set.',
  },
  {
    id: 'steps',
    label: 'Steps',
    description: 'A fixed set of ordered steps — the same procedure, followed the same way every time.',
  },
  {
    id: 'comments',
    label: 'Comments',
    description: 'A running thread the family can add short notes to over time.',
  },
  {
    id: 'supply',
    label: 'Supply level',
    description: 'A number that goes up or down — how much of something is left.',
  },
];

export function blockTypeMeta(type) {
  return BLOCK_TYPES.find((t) => t.id === type) || null;
}

export const RESET_CADENCES = [
  { id: 'never', label: 'Never', description: 'Stays ticked until someone unticks it — good for a one-off set of steps.' },
  { id: 'daily', label: 'Daily', description: 'Everything unticks again each day.' },
  { id: 'weekly', label: 'Weekly', description: 'Everything unticks again at the start of each week.' },
];

/* ---------------------------------------------------------------------------
   ID HELPERS

   Blocks live in Firestore as their own documents (so Firestore can give
   them an ID), but the things INSIDE a block — checklist items, steps,
   comment entries — are just array entries in a single document, so they
   need their own lightweight local IDs.
   ------------------------------------------------------------------------ */

let counter = 0;
export function localId(prefix = 'i') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/* ---------------------------------------------------------------------------
   CHECKLIST RESET
   ------------------------------------------------------------------------ */

/** Which period a checklist's ticked state belongs to, right now. */
export function currentPeriodKey(resetCadence, now = new Date()) {
  if (resetCadence === 'daily') return toISODate(now);
  if (resetCadence === 'weekly') return weekIdFor(now);
  return 'always';
}

/** A checklist's ticked items, accounting for the reset. If the stored period
 *  doesn't match the current one, it reads as empty without anything having
 *  been written yet. */
export function checkedItemsNow(block, now = new Date()) {
  const nowKey = currentPeriodKey(block.resetCadence, now);
  if (block.checkedPeriodKey !== nowKey) return [];
  return block.checkedItems || [];
}

export function isItemChecked(block, itemId, now = new Date()) {
  return checkedItemsNow(block, now).includes(itemId);
}

/**
 * Toggle one item, correctly handling the reset: if the block's stored
 * period is stale, this starts a fresh checked set for the new period rather
 * than toggling against last period's leftover state.
 */
export function toggleChecklistItem(block, itemId, checkedBy, now = new Date()) {
  const nowKey = currentPeriodKey(block.resetCadence, now);
  const current = checkedItemsNow(block, now);
  const isChecked = current.includes(itemId);

  const checkedItems = isChecked
    ? current.filter((id) => id !== itemId)
    : [...current, itemId];

  // Attribution only needs to track who ticked CURRENTLY-checked items —
  // stale entries from a previous period aren't meaningful to keep.
  const priorAttribution = block.checkedPeriodKey === nowKey ? (block.checkedBy || {}) : {};
  const checkedByMap = { ...priorAttribution };
  if (isChecked) delete checkedByMap[itemId];
  else checkedByMap[itemId] = checkedBy;

  return { checkedItems, checkedPeriodKey: nowKey, checkedBy: checkedByMap };
}

/** How many of a checklist's items are ticked right now, out of the total. */
export function checklistProgress(block, now = new Date()) {
  const total = (block.items || []).length;
  const done = checkedItemsNow(block, now).length;
  return { done, total };
}

/* ---------------------------------------------------------------------------
   GROUPING & ORDERING
   ------------------------------------------------------------------------ */

/** Blocks grouped by chore, each chore's blocks sorted into their saved order. */
export function groupBlocksByChore(blocks) {
  const byChore = new Map();
  for (const block of [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!byChore.has(block.choreId)) byChore.set(block.choreId, []);
    byChore.get(block.choreId).push(block);
  }
  return byChore;
}

/** Chore IDs that have at least one block, in saved box order. Any chore
 *  missing from the saved order (shouldn't normally happen) is appended at
 *  the end rather than silently dropped. */
export function orderedChoreIds(blocksByChore, boxOrder) {
  const known = [...blocksByChore.keys()];
  const ordered = (boxOrder || []).filter((id) => blocksByChore.has(id));
  const missing = known.filter((id) => !ordered.includes(id));
  return [...ordered, ...missing];
}

/** Move an entry from one index to another within an array, returning a new
 *  array. Used for both box order and within-box block order. */
export function moveItem(list, fromIndex, toIndex) {
  const copy = [...list];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}