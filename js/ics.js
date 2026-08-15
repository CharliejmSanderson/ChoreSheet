/* ============================================================================
   ics.js — turns a week into a calendar file you can import.

   This is a one-time snapshot, built entirely in the browser. If assignments
   change after someone imports it, their calendar won't know — they'd need to
   download again. That's the trade-off for needing no server at all.

   Events are all-day: a weekly chore becomes one multi-day event spanning the
   week, a daily chore becomes one event on each day it's assigned.
   ========================================================================== */

import { DAYS, datesOfWeek, fromISODate, addDays, toISODate } from './schedule.js';

/** Escape the characters that carry meaning in the calendar format. */
function esc(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** All-day dates are written as YYYYMMDD with no separators. */
const compact = (iso) => iso.replace(/-/g, '');

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Build the calendar text for a week.
 *
 * @param {Object} week      a saved week record
 * @param {Array}  members   family members, to turn IDs into names
 * @param {Object} opts
 *   - memberId: only include this person's chores (omit for the whole family)
 */
export function buildICS(week, members, opts = {}) {
  const { memberId = null } = opts;
  const nameOf = (id) => members.find((m) => m.id === id)?.name || 'Unassigned';
  const dates = datesOfWeek(week.id);
  const now = stamp();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Chores//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  let counter = 0;
  const event = ({ summary, startISO, endISO }) => {
    counter += 1;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${week.id}-${counter}-chores@family`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${compact(startISO)}`,
      // DTEND on an all-day event is exclusive, so it points at the day after.
      `DTEND;VALUE=DATE:${compact(endISO)}`,
      `SUMMARY:${esc(summary)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  };

  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      for (const day of DAYS) {
        const who = a.days?.[day];
        if (!who) continue;
        if (memberId && who !== memberId) continue;
        const start = dates[day];
        event({
          summary: `${a.choreName} — ${nameOf(who)}`,
          startISO: start,
          endISO: toISODate(addDays(fromISODate(start), 1)),
        });
      }
    } else {
      if (!a.assignedTo) continue;
      if (memberId && a.assignedTo !== memberId) continue;
      event({
        summary: `${a.choreName} — ${nameOf(a.assignedTo)}`,
        startISO: week.startDate,
        endISO: toISODate(addDays(fromISODate(week.endDate), 1)),
      });
    }
  }

  lines.push('END:VCALENDAR');

  // The calendar format wants CRLF line endings; some apps are fussy about it.
  return lines.join('\r\n');
}

/** Trigger a download of the week as a .ics file. */
export function downloadICS(week, members, opts = {}) {
  const text = buildICS(week, members, opts);
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const suffix = opts.memberId
    ? `-${(members.find((m) => m.id === opts.memberId)?.name || 'me').toLowerCase()}`
    : '';

  const link = document.createElement('a');
  link.href = url;
  link.download = `chores-${week.id}${suffix}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
