/* ============================================================================
   schedule.js — the fairness engine.

   HOW FAIRNESS WORKS

   Every person has a running total: everything they've ever been assigned,
   updated live as a week is built. Whoever's total is lowest goes next — for
   every single job, not just once per week. That one rule does three things
   at once: it keeps a week's jobs split as evenly as the numbers allow, it
   sends the odd leftover job to whoever's most due, and it correctly handles
   someone who's excluded from certain chores (see restrictionOf below),
   because being excluded just means their total stays lower, which then makes
   them next in line for whatever they ARE eligible for.

   An earlier version of this tracked "how many jobs so far this week"
   separately from the running total, resetting to zero every Monday. That
   seemed reasonable but had a real bug: restricted chores got handed out
   first, which pushed everyone else's weekly count up before an excluded
   person even entered the running — so they were only ever catching up to
   match the group, never getting a fair shot at the extra job. Using one
   running total instead of two separate numbers closed that gap.

   Within that, PER-CHORE fairness decides which chore each person gets:
   whoever's done that particular chore least comes first. It isn't a strict
   "lowest always wins" — that would make the roster completely predictable —
   so anyone within COUNT_TOLERANCE of the lowest is in the running, and the
   pick among them is random.

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

/** How close someone's overall total must be to the lowest to still be
 *  considered "equally due" for the next job. This is what keeps a week's
 *  jobs split as evenly as possible.
 *    0 (default) = strictly whoever is lowest goes next — 10 jobs across 5
 *      people is 2 each, every time; 11 jobs is 3/2/2/2/2, extra to whoever's
 *      most behind overall.
 *  Raise it to 1 to allow a little more shuffle, at the cost of a slightly
 *  less even split. */
export const TOTAL_TOLERANCE = 0;

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

   A chore's restriction is one of: 'none', 'adultOnly', 'childOnly'.

   Older saved data (chores and past week assignments) may only have a plain
   `adultOnly: true/false` boolean rather than `restriction` — restrictionOf
   reads either shape, so nothing needs migrating by hand.
   ------------------------------------------------------------------------ */

export function restrictionOf(obj) {
  if (obj?.restriction) return obj.restriction;
  if (obj?.adultOnly) return 'adultOnly';
  return 'none';
}

export function isEligible(member, chore, unavailableIds = []) {
  if (!member.active) return false;
  if (unavailableIds.includes(member.id)) return false;
  const restriction = restrictionOf(chore);
  if (restriction === 'adultOnly' && member.ageRestricted) return false;
  if (restriction === 'childOnly' && !member.ageRestricted) return false;
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
      restriction: restrictionOf(chore),
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
 * 1. Only people eligible for it (active, around, old enough — or young
 *    enough, for a kids-only chore).
 * 2. Keep everyone within TOTAL_TOLERANCE of the lowest running total. This
 *    one check does the "even split" work — see the file header for why it
 *    has to be the running total and not a separate weekly counter.
 * 3. Within that, keep everyone within COUNT_TOLERANCE of the lowest count
 *    FOR THIS SPECIFIC CHORE — this decides *which* chore each of them ends
 *    up with.
 * 4. Prefer people who haven't had this chore in the last week or so.
 * 5. Pick at random from whoever's still standing.
 */
function pickAssignee({ instance, members, counts, unavailable, history, weekId, rng }) {
  const chore = { restriction: instance.restriction };
  let pool = members.filter((m) => isEligible(m, chore, unavailable));
  if (pool.length === 0) return null;

  const lowestTotal = Math.min(...pool.map((m) => counts[m.id]?.total || 0));
  pool = pool.filter((m) => (counts[m.id]?.total || 0) <= lowestTotal + TOTAL_TOLERANCE);

  const lowest = Math.min(...pool.map((m) => countFor(counts, m.id, instance.choreId)));
  pool = pool.filter(
    (m) => countFor(counts, m.id, instance.choreId) <= lowest + COUNT_TOLERANCE);

  if (REPEAT_PENALTY_WEEKS > 0 && pool.length > 1) {
    const fresh = pool.filter(
      (m) => weeksSinceChore(history, m.id, instance.choreId, weekId) > REPEAT_PENALTY_WEEKS);
    if (fresh.length > 0) pool = fresh;
  }

  return pool[Math.floor(rng() * pool.length)];
}

/** Register one assignment against the running totals. */
function tally(counts, memberId, choreId) {
  if (!memberId) return;
  if (!counts[memberId]) counts[memberId] = emptyCount();
  counts[memberId].total += 1;
  counts[memberId].byChore[choreId] = (counts[memberId].byChore[choreId] || 0) + 1;
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

  // Counts as they stand before this week. Anyone who's been away — or
  // structurally excluded from some chores — naturally has a lower total, so
  // they come up first for whatever they're eligible for.
  const counts = computeCounts(history, members, { before: weekId });

  // Anything already assigned by hand is locked in first and counted, so the
  // automatic pass balances around those choices rather than ignoring them.
  const assigned = [];
  const toFill = [];

  for (const instance of instances) {
    const existing = fill === 'auto' ? undefined : preservedAssignee(preserve, instance);

    if (existing) {
      tally(counts, existing, instance.choreId);
      assigned.push({ ...instance, assignedTo: existing });
    } else if (fill === 'manual') {
      assigned.push({ ...instance, assignedTo: null });
    } else {
      toFill.push(instance);
    }
  }

  // Order matters. Two things go first because they have the least room to
  // manoeuvre, and leaving them till last forces bad picks:
  //   - jobs fewer people are allowed to do (adult-only or kids-only)
  //   - chores with fewer jobs to give out; a weekly chore has exactly one
  //     chance to land fairly, whereas a daily chore has seven and can spread
  //     itself around whatever's left
  // Random tie-break so the order isn't identical every week.
  const instanceCount = new Map();
  for (const inst of instances) {
    instanceCount.set(inst.choreId, (instanceCount.get(inst.choreId) || 0) + 1);
  }

  const eligibleCount = (instance) =>
    members.filter((m) => isEligible(m, { restriction: instance.restriction }, unavailable)).length;

  toFill.sort((a, b) =>
    (eligibleCount(a) - eligibleCount(b))
    || (instanceCount.get(a.choreId) - instanceCount.get(b.choreId))
    || (rng() - 0.5));

  for (const instance of toFill) {
    const person = pickAssignee({ instance, members, counts, unavailable, history, weekId, rng });
    if (person) tally(counts, person.id, instance.choreId);
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
        restriction: inst.restriction,
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