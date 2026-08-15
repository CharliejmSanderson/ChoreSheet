/* ============================================================================
   schedule.js — the fairness engine.

   This file is deliberately kept free of any UI or Firebase code. Everything in
   here is a pure function: same inputs, same outputs. That makes the numbers at
   the top safe to tweak without touching the rest of the app, and makes the
   whole thing testable.

   If the roster starts feeling unfair or too predictable, THE THREE CONSTANTS
   BELOW are the dials to turn. Nothing else should need editing.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   TUNABLE CONSTANTS
   ------------------------------------------------------------------------ */

/** How many past weeks feed the fairness calculation.
 *  Lower  = reacts fast, forgets fast (good if the family changes often).
 *  Higher = longer memory, smoother balance over time. */
export const TRAILING_WEEKS = 6;

/** Two people are treated as "tied" if their running scores are within this
 *  much of each other. Ties get broken randomly, which stops the roster
 *  becoming a robotic, predictable rotation.
 *  Set to 0 for strict "lowest score always wins" (more rigid, more fair).
 *  Raise it for more shuffle. Roughly: set it near your smallest chore weight. */
export const TIE_TOLERANCE = 1;

/** Avoid giving someone the exact same chore they had this many weeks ago.
 *  Only applies when there's another tied candidate available — fairness always
 *  wins over variety. Set to 0 to switch this off entirely. */
export const REPEAT_PENALTY_WEEKS = 1;

/** Ceiling on how much any one person can be given in a SINGLE week, as a
 *  multiple of that week's fair share.
 *
 *  Without this, someone coming back from a week away gets handed their entire
 *  backlog at once — landing them with roughly double a normal week, which
 *  reads as a punishment for having been away. With it, the catch-up spreads
 *  over two or three weeks instead, and the long-run totals still even out.
 *
 *  1.0 = nobody ever exceeds a fair share (rigid; can leave chores unassigned
 *  if the numbers don't divide neatly). 1.3 is a sensible middle. Set very high
 *  (e.g. 99) to switch the cap off and go back to catching up in one hit. */
export const MAX_WEEKLY_SHARE = 1.3;

/** Day keys, Monday-first. The order matters: it's the order daily chores get
 *  assigned in, and the order they're displayed in. */
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

   Every date is handled as a local "YYYY-MM-DD" string, never a UTC timestamp.
   This matters: using UTC would shift the week boundary for anyone not on UTC
   and could land a Monday on the wrong day. Weeks run Monday -> Sunday.
   ------------------------------------------------------------------------ */

/** Format a Date as a local YYYY-MM-DD string (no timezone shifting). */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a local YYYY-MM-DD string back into a Date at local midnight. */
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** The Monday of the week containing `date`. This is a week's ID. */
export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();            // 0 = Sunday ... 6 = Saturday
  const offset = dow === 0 ? -6 : 1 - dow; // Sunday belongs to the week just ending
  return addDays(d, offset);
}

/** Week ID (the Monday, as YYYY-MM-DD) for whatever week contains `date`. */
export function weekIdFor(date = new Date()) {
  return toISODate(mondayOf(date));
}

export function nextWeekId(weekId) {
  return toISODate(addDays(fromISODate(weekId), 7));
}

export function prevWeekId(weekId) {
  return toISODate(addDays(fromISODate(weekId), -7));
}

/** Whole weeks between two week IDs. Positive if `later` is after `earlier`. */
export function weeksBetween(earlier, later) {
  const ms = fromISODate(later) - fromISODate(earlier);
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

/** The seven dates of a week, keyed by day. */
export function datesOfWeek(weekId) {
  const monday = fromISODate(weekId);
  const out = {};
  DAYS.forEach((day, i) => { out[day] = toISODate(addDays(monday, i)); });
  return out;
}

/** Human-readable week range, e.g. "17–23 Aug 2026". */
export function formatWeekRange(weekId) {
  const start = fromISODate(weekId);
  const end = addDays(start, 6);
  const month = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  const sameMonth = start.getMonth() === end.getMonth();
  const left = sameMonth
    ? `${start.getDate()}`
    : `${start.getDate()} ${month(start)}`;
  return `${left}–${end.getDate()} ${month(end)} ${end.getFullYear()}`;
}

/* ---------------------------------------------------------------------------
   ELIGIBILITY
   ------------------------------------------------------------------------ */

/** Can this person be given this chore this week? */
export function isEligible(member, chore, unavailableIds = []) {
  if (!member.active) return false;
  if (unavailableIds.includes(member.id)) return false;
  if (chore.adultOnly && member.ageRestricted) return false;
  return true;
}

/* ---------------------------------------------------------------------------
   SCORING

   A person's score is the total weight of everything they were actually
   assigned across the trailing window. Crucially this is ALWAYS recomputed
   from saved week records — it is never stored as its own field, so it can't
   drift out of sync when assignments get edited mid-week.

   Each saved assignment carries the weight that was in effect when the week was
   generated, so re-weighting a chore later never rewrites history.
   ------------------------------------------------------------------------ */

/** Total weight each member carries in a single saved week record. */
export function scoreOfWeek(week) {
  const totals = {};
  const add = (memberId, weight) => {
    if (!memberId) return;
    totals[memberId] = (totals[memberId] || 0) + (Number(weight) || 0);
  };

  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      // A daily chore counts once per day, to whoever did that day — not seven
      // times to a single person.
      for (const day of DAYS) add(a.days?.[day], a.weight);
    } else {
      add(a.assignedTo, a.weight);
    }
  }
  return totals;
}

/**
 * Running fairness scores across the trailing window.
 *
 * @param {Array}  weeks        all saved week records (any order)
 * @param {Array}  members      family members
 * @param {Object} opts
 *   - before:        only count weeks strictly before this week ID
 *   - trailingWeeks: window size (defaults to TRAILING_WEEKS)
 * @returns {Object} { [memberId]: score } — every member present, zeroed if idle
 */
export function computeScores(weeks, members, opts = {}) {
  const { before = null, trailingWeeks = TRAILING_WEEKS } = opts;

  const relevant = weeks
    .filter((w) => (before ? w.id < before : true))
    .sort((a, b) => (a.id < b.id ? 1 : -1)) // newest first
    .slice(0, trailingWeeks);

  const scores = {};
  for (const m of members) scores[m.id] = 0;

  for (const week of relevant) {
    const totals = scoreOfWeek(week);
    for (const [memberId, value] of Object.entries(totals)) {
      // Guard against members who have since been deleted.
      if (memberId in scores) scores[memberId] += value;
    }
  }
  return scores;
}

/**
 * How many weeks ago did this person last have this exact chore?
 * Returns Infinity if they haven't had it inside the window.
 */
export function weeksSinceChore(weeks, memberId, choreId, targetWeekId) {
  let best = Infinity;

  for (const week of weeks) {
    if (week.id >= targetWeekId) continue; // only look backwards
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

   The heart of the "weekly vs daily" distinction. Before anything is assigned,
   the chore list is flattened into individual pieces of work:
     - a weekly chore  -> 1 instance  (one owner, all week)
     - a daily chore   -> 7 instances (assigned independently, day by day)

   Everything downstream then treats those instances identically, which is what
   stops a heavy daily chore landing on one person seven times over.
   ------------------------------------------------------------------------ */

export function expandInstances(chores) {
  const instances = [];

  for (const chore of chores) {
    if (!chore.active) continue;

    const base = {
      choreId: chore.id,
      choreName: chore.name,
      weight: Number(chore.weight) || 0, // snapshotted here, at generation time
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
   THE ASSIGNMENT PASS
   ------------------------------------------------------------------------ */

/**
 * Pick who gets one instance.
 *
 * 1. Filter to eligible people.
 * 2. Find the lowest running score.
 * 3. Take everyone within TIE_TOLERANCE of it — these are the "tied" candidates.
 * 4. Prefer tied candidates who did NOT have this chore recently. If that rules
 *    out everybody, fall back to the full tied set (fairness beats variety).
 * 5. Pick randomly from what's left.
 */
function pickAssignee({
  instance, members, scores, unavailable, history, weekId, rng,
  weekLoad = {}, cap = Infinity,
}) {
  const chore = { adultOnly: instance.adultOnly };
  let eligible = members.filter((m) => isEligible(m, chore, unavailable));
  if (eligible.length === 0) return null;

  // Hold back anyone who has already hit this week's ceiling — but only while
  // somebody else can take it. A chore never goes unassigned just to respect
  // the cap; the cap is a preference, not a hard rule.
  const underCap = eligible.filter((m) => (weekLoad[m.id] ?? 0) < cap);
  if (underCap.length > 0) eligible = underCap;

  const lowest = Math.min(...eligible.map((m) => scores[m.id] ?? 0));
  const tied = eligible.filter((m) => (scores[m.id] ?? 0) <= lowest + TIE_TOLERANCE);

  let pool = tied;
  if (REPEAT_PENALTY_WEEKS > 0 && tied.length > 1) {
    const fresh = tied.filter(
      (m) => weeksSinceChore(history, m.id, instance.choreId, weekId) > REPEAT_PENALTY_WEEKS
    );
    if (fresh.length > 0) pool = fresh;
  }

  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Generate a full week's assignments.
 *
 * @param {Object} opts
 *   - weekId       week to generate (Monday, YYYY-MM-DD)
 *   - chores       current chore list
 *   - members      current family members
 *   - unavailable  member IDs sitting this week out
 *   - history      all previously saved week records
 *   - rng          optional random source, injectable for testing
 *
 * @returns {Object} a week record ready to save
 */
export function generateWeek({
  weekId,
  chores,
  members,
  unavailable = [],
  history = [],
  rng = Math.random,
}) {
  // Step 1 — flatten into individual pieces of work.
  const instances = expandInstances(chores);

  // Step 2 — starting scores from the trailing window. Anyone who was away has
  // naturally accumulated less, so they'll be picked first here until they've
  // caught back up. That's the catch-up behaviour: no separate deficit field.
  const scores = computeScores(history, members, { before: weekId });

  // Step 3 — heaviest first. Assigning the worst jobs while the score gaps are
  // still wide is what lets the lighter chores even things out afterwards.
  const ordered = [...instances].sort((a, b) => b.weight - a.weight);

  // How much work is going out this week, and what one person's fair slice of
  // it looks like. The cap keeps any single week from becoming a pile-on.
  const totalWeight = instances.reduce((sum, i) => sum + i.weight, 0);
  const availableCount =
    members.filter((m) => m.active && !unavailable.includes(m.id)).length || 1;
  const cap = (totalWeight / availableCount) * MAX_WEEKLY_SHARE;

  // Step 4/5 — assign one at a time, updating the running score as we go so the
  // pass self-balances within this week, not just against past weeks.
  const assigned = [];
  const weekLoad = {};
  for (const m of members) weekLoad[m.id] = 0;

  for (const instance of ordered) {
    const person = pickAssignee({
      instance, members, scores, unavailable, history, weekId, rng, weekLoad, cap,
    });

    if (person) {
      scores[person.id] += instance.weight;   // long-run fairness
      weekLoad[person.id] += instance.weight; // this week's ceiling
    }
    assigned.push({ ...instance, assignedTo: person ? person.id : null });
  }

  // Step 6 — fold the instances back into one record per chore.
  const byChore = new Map();
  for (const inst of assigned) {
    if (!byChore.has(inst.choreId)) {
      byChore.set(inst.choreId, {
        choreId: inst.choreId,
        choreName: inst.choreName,
        weight: inst.weight,
        adultOnly: inst.adultOnly,
        type: inst.type,
        ...(inst.type === 'daily' ? { days: {} } : { assignedTo: null }),
      });
    }
    const record = byChore.get(inst.choreId);
    if (inst.type === 'daily') record.days[inst.day] = inst.assignedTo;
    else record.assignedTo = inst.assignedTo;
  }

  // Present chores in a stable, readable order rather than weight order.
  const assignments = [...byChore.values()].sort((a, b) =>
    a.choreName.localeCompare(b.choreName)
  );

  const start = fromISODate(weekId);
  return {
    id: weekId,
    startDate: weekId,
    endDate: toISODate(addDays(start, 6)),
    generatedAt: new Date().toISOString(),
    generatedBy: null, // filled in by the caller, who knows who's using the app
    unavailable: [...unavailable],
    assignments,
  };
}

/* ---------------------------------------------------------------------------
   READ HELPERS FOR THE UI
   ------------------------------------------------------------------------ */

/** Flatten a saved week into per-person rows, for "what do I have on?" views. */
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

/** Which week should we offer to generate next? The first ungenerated one. */
export function nextUngeneratedWeekId(existingWeekIds, from = new Date()) {
  let candidate = weekIdFor(from);
  const known = new Set(existingWeekIds);
  // Walk forward until we hit a week that doesn't exist yet. The cap is just a
  // safety net so a bad data state can't spin forever.
  for (let i = 0; i < 520 && known.has(candidate); i++) {
    candidate = nextWeekId(candidate);
  }
  return candidate;
}
