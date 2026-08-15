/* ============================================================================
   schedule.js — the fairness engine.

   HOW FAIRNESS WORKS

   Every chore is tracked per person, per chore: "Sam has walked the dog 4
   times, Ella 6". When a chore needs assigning, whoever has done that
   particular chore least often comes first. Do that for every chore and each
   person ends up doing each job a roughly equal number of times.

   It isn't a strict "lowest count always wins" — that would make the roster
   completely predictable. Anyone within COUNT_TOLERANCE of the lowest is in
   the running, and the pick among them is random.

   This file is deliberately free of any UI or Firebase code. Everything here
   is a pure function, so the constants below are safe to tune on their own.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   TUNABLE CONSTANTS
   ------------------------------------------------------------------------ */

/** How far back the counts look, in weeks. 0 means all time.
 *  All time is usually what you want — it's what makes "we've each done this
 *  the same number of times" true over the long run. Set a number (e.g. 12) if
 *  you'd rather old history stopped counting. */
export const HISTORY_WEEKS = 0;

/** How close someone's count must be to the lowest to still be in the running.
 *  This is the variety dial.
 *    0  = strictly whoever has done it least (fairest, very predictable)
 *    1  = anyone within one go of the lowest (default: fair but varied)
 *    2+ = looser still, more shuffle, slower to even out */
export const COUNT_TOLERANCE = 1;

/** Avoid giving someone the same chore they had this many weeks ago, as long
 *  as there's another equally-due candidate. Set to 0 to switch off. */
export const REPEAT_PENALTY_WEEKS = 1;

/** How uneven a single week is allowed to be.
 *
 *  0 (the default) means everyone gets the same number of jobs, give or take
 *  the remainder when it doesn't divide evenly — 10 jobs across 5 people is
 *  2 each; 11 jobs is 3/2/2/2/2, and the extra goes to whoever has done the
 *  fewest overall.
 *
 *  Raise it to 1 to let the week be a little lopsided in exchange for faster
 *  catch-up after someone's been away. */
export const WEEKLY_TOLERANCE = 0;

/** Day keys, Monday-first. */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/* ---------------------------------------------------------------------------
   DATE HELPERS

   Dates are local "YYYY-MM-DD" strings, never UTC timestamps — UTC would shift
   the week boundary for anyone outside it. Weeks run Monday -> Sunday.
   ------------------------------------------------------------------------ */

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();                    // 0 = Sunday ... 6 = Saturday
  const offset = dow === 0 ? -6 : 1 - dow;   // Sunday belongs to the week ending
  return addDays(d, offset);
}

export function weekIdFor(date = new Date()) {
  return toISODate(mondayOf(date));
}

export const nextWeekId = (weekId) => toISODate(addDays(fromISODate(weekId), 7));
export const prevWeekId = (weekId) => toISODate(addDays(fromISODate(weekId), -7));

export function weeksBetween(earlier, later) {
  const ms = fromISODate(later) - fromISODate(earlier);
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

export function datesOfWeek(weekId) {
  const monday = fromISODate(weekId);
  const out = {};
  DAYS.forEach((day, i) => { out[day] = toISODate(addDays(monday, i)); });
  return out;
}

/** "17–23 Aug 2026" */
export function formatWeekRange(weekId) {
  const start = fromISODate(weekId);
  const end = addDays(start, 6);
  const month = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  const sameMonth = start.getMonth() === end.getMonth();
  const left = sameMonth ? `${start.getDate()}` : `${start.getDate()} ${month(start)}`;
  return `${left}–${end.getDate()} ${month(end)} ${end.getFullYear()}`;
}

/* ---------------------------------------------------------------------------
   ELIGIBILITY
   ------------------------------------------------------------------------ */

export function isEligible(member, chore, unavailableIds = []) {
  if (!member.active) return false;
  if (unavailableIds.includes(member.id)) return false;
  if (chore.adultOnly && member.ageRestricted) return false;
  return true;
}

/* ---------------------------------------------------------------------------
   COUNTING

   Counts are always recomputed from saved week records — never stored as their
   own field, so they can't drift out of sync when a week is edited by hand.
   A daily chore counts once per day, to whoever actually did that day.
   ------------------------------------------------------------------------ */

const emptyCount = () => ({ total: 0, byChore: {} });

/** Per-person counts within a single saved week. */
export function countsOfWeek(week) {
  const out = {};
  const add = (memberId, choreId) => {
    if (!memberId) return;
    if (!out[memberId]) out[memberId] = emptyCount();
    out[memberId].total += 1;
    out[memberId].byChore[choreId] = (out[memberId].byChore[choreId] || 0) + 1;
  };

  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      for (const day of DAYS) add(a.days?.[day], a.choreId);
    } else {
      add(a.assignedTo, a.choreId);
    }
  }
  return out;
}

/**
 * How many times each person has done each chore.
 * @returns {Object} { [memberId]: { total, byChore: { [choreId]: n } } }
 */
export function computeCounts(weeks, members, opts = {}) {
  const { before = null, historyWeeks = HISTORY_WEEKS } = opts;

  let relevant = weeks
    .filter((w) => (before ? w.id < before : true))
    .sort((a, b) => (a.id < b.id ? 1 : -1)); // newest first

  if (historyWeeks > 0) relevant = relevant.slice(0, historyWeeks);

  const counts = {};
  for (const m of members) counts[m.id] = emptyCount();

  for (const week of relevant) {
    for (const [memberId, weekCount] of Object.entries(countsOfWeek(week))) {
      if (!counts[memberId]) continue; // someone since removed from the family
      counts[memberId].total += weekCount.total;
      for (const [choreId, n] of Object.entries(weekCount.byChore)) {
        counts[memberId].byChore[choreId] = (counts[memberId].byChore[choreId] || 0) + n;
      }
    }
  }
  return counts;
}

/** How many times this person has done this chore. */
export const countFor = (counts, memberId, choreId) =>
  counts[memberId]?.byChore?.[choreId] || 0;

/** How many weeks ago this person last had this chore. Infinity if never. */
export function weeksSinceChore(weeks, memberId, choreId, targetWeekId) {
  let best = Infinity;

  for (const week of weeks) {
    if (week.id >= targetWeekId) continue;
    const gap = weeksBetween(week.id, targetWeekId);
    if (gap >= best) continue;

    const had = (week.assignments || []).some((a) => {
      if (a.choreId !== choreId) return false;
      if (a.type === 'daily') return DAYS.some((d) => a.days?.[d] === memberId);
      return a.assignedTo === memberId;
    });

    if (had) best = gap;
  }
  return best;
}

/* ---------------------------------------------------------------------------
   INSTANCE EXPANSION

   Chores are flattened into individual jobs before anything is assigned:
     weekly chore -> 1 job  (one owner, all week)
     daily chore  -> 7 jobs (assigned independently, day by day)
   ------------------------------------------------------------------------ */

export function expandInstances(chores) {
  const instances = [];

  for (const chore of chores) {
    if (!chore.active) continue;

    const base = {
      choreId: chore.id,
      choreName: chore.name,
      notes: chore.notes || '',   // snapshotted, so past weeks keep the old note
      adultOnly: !!chore.adultOnly,
    };

    if (chore.frequency === 'daily') {
      for (const day of DAYS) instances.push({ ...base, type: 'daily', day });
    } else {
      instances.push({ ...base, type: 'weekly', day: null });
    }
  }
  return instances;
}

/* ---------------------------------------------------------------------------
   PICKING SOMEONE
   ------------------------------------------------------------------------ */

/**
 * Choose who gets one job.
 *
 * 1. Only people eligible for it (active, around, old enough).
 * 2. Of those, only the ones carrying the fewest jobs SO FAR THIS WEEK. This
 *    is what keeps the week evenly split — it's checked before anything else,
 *    so no one can be handed a third job while someone else still has one.
 * 3. Keep everyone within COUNT_TOLERANCE of the lowest count FOR THIS CHORE.
 *    Among people with the same weekly load, this decides *which* chore each
 *    of them ends up with.
 * 4. Prefer people who haven't had this chore in the last week or so.
 * 5. Prefer whoever has the lowest total across all chores. This is what sends
 *    the odd remaining job to whoever's done the fewest overall.
 * 6. Pick at random from whoever's still standing.
 */
function pickAssignee({
  instance, members, counts, unavailable, history, weekId, rng, weekLoad = {},
}) {
  const chore = { adultOnly: instance.adultOnly };
  let pool = members.filter((m) => isEligible(m, chore, unavailable));
  if (pool.length === 0) return null;

  // 2 — even split first. Everything below only breaks ties within this group.
  const lightest = Math.min(...pool.map((m) => weekLoad[m.id] ?? 0));
  pool = pool.filter((m) => (weekLoad[m.id] ?? 0) <= lightest + WEEKLY_TOLERANCE);

  // 3 — lowest count of this specific chore
  const lowest = Math.min(...pool.map((m) => countFor(counts, m.id, instance.choreId)));
  pool = pool.filter(
    (m) => countFor(counts, m.id, instance.choreId) <= lowest + COUNT_TOLERANCE);

  // 4 — avoid an immediate repeat where we can afford to
  if (REPEAT_PENALTY_WEEKS > 0 && pool.length > 1) {
    const fresh = pool.filter(
      (m) => weeksSinceChore(history, m.id, instance.choreId, weekId) > REPEAT_PENALTY_WEEKS);
    if (fresh.length > 0) pool = fresh;
  }

  // 5 — tie-break on overall workload
  if (pool.length > 1) {
    const lowestTotal = Math.min(...pool.map((m) => counts[m.id]?.total || 0));
    pool = pool.filter((m) => (counts[m.id]?.total || 0) <= lowestTotal + COUNT_TOLERANCE);
  }

  // 6 — random among equals
  return pool[Math.floor(rng() * pool.length)];
}

/** Register one assignment against the running tallies. */
function tally(counts, weekLoad, memberId, choreId) {
  if (!memberId) return;
  if (!counts[memberId]) counts[memberId] = emptyCount();
  counts[memberId].total += 1;
  counts[memberId].byChore[choreId] = (counts[memberId].byChore[choreId] || 0) + 1;
  weekLoad[memberId] = (weekLoad[memberId] || 0) + 1;
}

/** Read an existing assignee out of a week record, for a given job. */
function preservedAssignee(week, instance) {
  if (!week) return undefined;
  const record = (week.assignments || []).find((a) => a.choreId === instance.choreId);
  if (!record) return undefined;
  return instance.type === 'daily' ? record.days?.[instance.day] : record.assignedTo;
}

/* ---------------------------------------------------------------------------
   GENERATING A WEEK
   ------------------------------------------------------------------------ */

/**
 * Build a week's assignments.
 *
 * @param {Object} opts
 *   - weekId       the Monday, YYYY-MM-DD
 *   - chores       current chore list
 *   - members      family members
 *   - unavailable  member IDs sitting this week out
 *   - history      previously saved week records
 *   - fill         'auto'   assign everything (default)
 *                  'manual' leave it all unassigned, to be done by hand
 *                  'rest'   keep what's already assigned, fill in the gaps
 *   - preserve     an existing week record — required for fill: 'rest'
 *   - rng          injectable random source, for testing
 */
export function generateWeek({
  weekId,
  chores,
  members,
  unavailable = [],
  history = [],
  fill = 'auto',
  preserve = null,
  rng = Math.random,
}) {
  const instances = expandInstances(chores);

  // Counts as they stand before this week. Anyone who's been away naturally has
  // lower counts, so they come up first when the odd job needs a home.
  const counts = computeCounts(history, members, { before: weekId });

  const weekLoad = {};
  for (const m of members) weekLoad[m.id] = 0;

  // Anything already assigned by hand is locked in first and counted, so the
  // automatic pass balances around those choices rather than ignoring them.
  const assigned = [];
  const toFill = [];

  for (const instance of instances) {
    const existing = fill === 'auto' ? undefined : preservedAssignee(preserve, instance);

    if (existing) {
      tally(counts, weekLoad, existing, instance.choreId);
      assigned.push({ ...instance, assignedTo: existing });
    } else if (fill === 'manual') {
      assigned.push({ ...instance, assignedTo: null });
    } else {
      toFill.push(instance);
    }
  }

  // Order matters. Two things go first because they have the least room to
  // manoeuvre, and leaving them till last forces bad picks:
  //   - jobs fewer people are allowed to do (adults-only)
  //   - chores with fewer jobs to give out; a weekly chore has exactly one
  //     chance to land fairly, whereas a daily chore has seven and can spread
  //     itself around whatever's left
  // Random tie-break so the order isn't identical every week.
  const instanceCount = new Map();
  for (const inst of instances) {
    instanceCount.set(inst.choreId, (instanceCount.get(inst.choreId) || 0) + 1);
  }

  const eligibleCount = (instance) =>
    members.filter((m) => isEligible(m, { adultOnly: instance.adultOnly }, unavailable)).length;

  toFill.sort((a, b) =>
    (eligibleCount(a) - eligibleCount(b))
    || (instanceCount.get(a.choreId) - instanceCount.get(b.choreId))
    || (rng() - 0.5));

  for (const instance of toFill) {
    const person = pickAssignee({
      instance, members, counts, unavailable, history, weekId, rng, weekLoad,
    });
    if (person) tally(counts, weekLoad, person.id, instance.choreId);
    assigned.push({ ...instance, assignedTo: person ? person.id : null });
  }

  // Fold the individual jobs back into one record per chore.
  const byChore = new Map();
  for (const inst of assigned) {
    if (!byChore.has(inst.choreId)) {
      byChore.set(inst.choreId, {
        choreId: inst.choreId,
        choreName: inst.choreName,
        notes: inst.notes || '',
        adultOnly: inst.adultOnly,
        type: inst.type,
        ...(inst.type === 'daily' ? { days: {} } : { assignedTo: null }),
      });
    }
    const record = byChore.get(inst.choreId);
    if (inst.type === 'daily') record.days[inst.day] = inst.assignedTo;
    else record.assignedTo = inst.assignedTo;
  }

  const assignments = [...byChore.values()].sort((a, b) =>
    a.choreName.localeCompare(b.choreName));

  return {
    id: weekId,
    startDate: weekId,
    endDate: toISODate(addDays(fromISODate(weekId), 6)),
    generatedAt: new Date().toISOString(),
    generatedBy: null,     // filled in by the caller
    unavailable: [...unavailable],
    assignments,
  };
}

/* ---------------------------------------------------------------------------
   READ HELPERS FOR THE UI
   ------------------------------------------------------------------------ */

/** Everything one person has on in a week. */
export function assignmentsForMember(week, memberId) {
  const out = [];
  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      const days = DAYS.filter((d) => a.days?.[d] === memberId);
      if (days.length) out.push({ ...a, days });
    } else if (a.assignedTo === memberId) {
      out.push({ ...a });
    }
  }
  return out;
}

/** How many jobs in this week still have nobody against them. */
export function unassignedCount(week) {
  let n = 0;
  for (const a of week?.assignments || []) {
    if (a.type === 'daily') n += DAYS.filter((d) => !a.days?.[d]).length;
    else if (!a.assignedTo) n += 1;
  }
  return n;
}

/** Total jobs in a week, assigned or not. */
export function totalJobs(week) {
  let n = 0;
  for (const a of week?.assignments || []) n += a.type === 'daily' ? DAYS.length : 1;
  return n;
}

/** The first week that hasn't been drawn up yet. */
export function nextUngeneratedWeekId(existingWeekIds, from = new Date()) {
  let candidate = weekIdFor(from);
  const known = new Set(existingWeekIds);
  for (let i = 0; i < 520 && known.has(candidate); i++) candidate = nextWeekId(candidate);
  return candidate;
}