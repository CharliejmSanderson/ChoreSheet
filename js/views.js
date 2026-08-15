/* ============================================================================
   views.js — the four screens.

   Every view is a function that takes a context object and returns a DOM node.
   They never write data directly; they call functions on `ctx.actions`, which
   live in app.js. That keeps "what the screen looks like" separate from "what
   happens when you tap it".
   ========================================================================== */

import { h, icon, personChip, personDot, tapeVar, timeAgo, openSheet, closeSheet } from './ui.js';
import {
  DAYS, DAY_LABELS, TRAILING_WEEKS,
  formatWeekRange, datesOfWeek, weekIdFor, computeScores,
  isEligible, toISODate,
} from './schedule.js';

/* ---------------------------------------------------------------------------
   WEEK VIEW — the home screen, and the thing people actually open the app for
   ------------------------------------------------------------------------ */

export function weekView(ctx) {
  const { members, weeks, state, actions, who } = ctx;
  const week = weeks.find((w) => w.id === state.weekId) || null;
  const isCurrent = state.weekId === weekIdFor();

  const wrap = h('div', {});
  wrap.append(weekNav(ctx, isCurrent));

  if (!week) {
    wrap.append(notGeneratedYet(ctx));
    return wrap;
  }

  // Who's sitting this week out
  if (week.unavailable?.length) {
    const names = week.unavailable
      .map((id) => members.find((m) => m.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    if (names) {
      wrap.append(h('div', { class: 'banner' },
        icon('warn', 17),
        h('div', {}, h('strong', {}, 'Away this week: '), names,
          h('div', { class: 'small', style: { 'margin-top': '2px' } },
            'They pick up more once they\'re back.'))));
    }
  }

  // "Just mine" filter — only offered once someone has said who they are
  if (who) {
    wrap.append(h('div', { class: 'seg-control', style: { 'margin-bottom': '12px' } },
      h('button', {
        'aria-pressed': String(!state.mineOnly),
        onclick: () => actions.setMineOnly(false),
      }, 'Everyone'),
      h('button', {
        'aria-pressed': String(state.mineOnly),
        onclick: () => actions.setMineOnly(true),
      }, 'Just mine')));
  }

  const visible = (week.assignments || []).filter((a) => {
    if (!state.mineOnly || !who) return true;
    if (a.type === 'daily') return DAYS.some((d) => a.days?.[d] === who);
    return a.assignedTo === who;
  });

  if (visible.length === 0) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, state.mineOnly ? 'Nothing on for you' : 'No chores in this week'),
      h('p', {}, state.mineOnly
        ? 'Enjoy it. Switch to Everyone to see the full list.'
        : 'Add some chores under Manage, then generate the week again.')));
  } else {
    const list = h('div', { class: 'card card-flush stagger' });
    for (const a of visible) list.append(choreRow(ctx, week, a));
    wrap.append(list);
  }

  wrap.append(weekActions(ctx, week));
  return wrap;
}

function weekNav(ctx, isCurrent) {
  const { state, actions } = ctx;
  return h('div', { class: 'week-nav' },
    h('button', {
      class: 'nav-btn',
      'aria-label': 'Previous week',
      onclick: () => actions.stepWeek(-1),
    }, icon('left')),
    h('div', { style: { 'text-align': 'center', flex: '1 1 auto', 'min-width': '0' } },
      h('div', { class: 'when' }, isCurrent ? 'This week' : label(state.weekId)),
      h('h1', {}, formatWeekRange(state.weekId))),
    h('button', {
      class: 'nav-btn',
      'aria-label': 'Next week',
      onclick: () => actions.stepWeek(1),
    }, icon('right')));
}

function label(weekId) {
  const current = weekIdFor();
  if (weekId > current) return 'Coming up';
  return 'Past week';
}

function notGeneratedYet(ctx) {
  const { state, actions, chores, members } = ctx;
  const activeChores = chores.filter((c) => c.active);
  const activeMembers = members.filter((m) => m.active);
  const ready = activeChores.length > 0 && activeMembers.length > 0;

  return h('div', { class: 'card empty' },
    h('h2', {}, 'This week hasn\'t been drawn up'),
    h('p', {}, ready
      ? 'Everyone gets chores based on what they\'ve carried the last few weeks.'
      : 'Add at least one person and one chore under Manage first.'),
    ready
      ? h('button', {
          class: 'btn',
          onclick: () => actions.openGenerate(state.weekId),
        }, icon('wand', 17), 'Draw up this week')
      : h('button', { class: 'btn btn-ghost', onclick: () => actions.setTab('manage') },
          'Go to Manage'));
}

/** One chore. Weekly chores are a single tappable row; daily chores show a
 *  seven-day strip where each day can be reassigned on its own. */
function choreRow(ctx, week, assignment) {
  const { members, actions, state } = ctx;
  const meta = h('div', { class: 'chore-meta' },
    h('span', { class: 'weight-tag' }, `weight ${assignment.weight}`),
    assignment.adultOnly ? h('span', {}, 'Adults only') : null,
    h('span', {}, assignment.type === 'daily' ? 'Different each day' : 'All week'));

  if (assignment.type === 'weekly') {
    return h('button', {
      class: 'chore-item',
      onclick: () => actions.openReassign(week.id, assignment, null),
    },
      h('div', { class: 'grow' },
        h('div', { class: 'chore-name' }, assignment.choreName),
        meta),
      personChip(members, assignment.assignedTo));
  }

  const today = toISODate(new Date());
  const dates = datesOfWeek(week.id);

  const strip = h('div', { class: 'day-strip' });
  for (const day of DAYS) {
    const memberId = assignment.days?.[day];
    const member = members.find((m) => m.id === memberId);
    const mine = state.mineOnly && memberId === ctx.who;

    strip.append(h('button', {
      class: `day-cell${dates[day] === today ? ' is-today' : ''}`,
      style: mine ? { 'border-color': tapeVar(members, memberId) } : {},
      'aria-label': `${assignment.choreName}, ${DAY_LABELS[day]}: ${member?.name || 'nobody'}`,
      onclick: () => actions.openReassign(week.id, assignment, day),
    },
      h('span', { class: 'day-label' }, day.slice(0, 1).toUpperCase() + day.slice(1, 2)),
      member
        ? personDot(members, memberId, member.name)
        : h('span', { class: 'dot', style: { '--tape': 'var(--ink-3)' } }, '–')));
  }

  return h('div', { class: 'chore-item', style: { display: 'block', cursor: 'default' } },
    h('div', { class: 'chore-name' }, assignment.choreName),
    meta,
    strip);
}

function weekActions(ctx, week) {
  const { actions } = ctx;
  return h('div', { class: 'row wrap', style: { 'margin-top': '14px', gap: '8px' } },
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openSwap(week.id) },
      icon('swap', 16), 'Swap chores'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openExport(week.id) },
      icon('download', 16), 'Add to calendar'),
    h('button', { class: 'btn btn-quiet btn-sm', onclick: () => actions.openRegenerate(week.id) },
      'Redraw week'));
}

/* ---------------------------------------------------------------------------
   BALANCE VIEW

   The signature screen: one bar, split by person. Even segments mean an even
   load. The dashed notches show where a perfectly even split would fall, so
   you can see imbalance without reading any numbers.
   ------------------------------------------------------------------------ */

export function balanceView(ctx) {
  const { members, weeks } = ctx;
  const active = members.filter((m) => m.active);
  const scores = computeScores(weeks, active, { trailingWeeks: TRAILING_WEEKS });
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);

  const wrap = h('div', {});
  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, `Last ${TRAILING_WEEKS} weeks`),
      h('h2', {}, 'Who\'s carried what'))));

  if (active.length === 0 || total === 0) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'Nothing to weigh up yet'),
      h('p', {}, 'Once a week or two has been drawn up, the balance shows here.')));
    return wrap;
  }

  const card = h('div', { class: 'card' });

  const strip = h('div', { class: 'balance-strip', role: 'img',
    'aria-label': active.map((m) => `${m.name}: ${scores[m.id]}`).join(', ') });

  for (const member of active) {
    const value = scores[member.id] || 0;
    strip.append(h('div', {
      class: 'balance-seg',
      style: { '--tape': tapeVar(members, member.id), 'flex-grow': String(Math.max(value, 0.001)) },
      title: `${member.name}: ${value}`,
    }, value > 0 && total / active.length > 4 ? String(value) : ''));
  }

  // Even-split notches sit on top of the segments.
  const ticks = h('div', { class: 'balance-ticks', 'aria-hidden': 'true' });
  for (let i = 0; i < active.length; i++) ticks.append(h('div', { class: 'balance-tick' }));
  strip.append(ticks);

  card.append(strip);
  card.append(h('p', { class: 'small muted', style: { margin: '10px 0 0' } },
    'Dashes mark an even split. A segment wider than its dash means that person is carrying more.'));

  const legend = h('div', { class: 'balance-legend' });
  const sorted = [...active].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
  for (const member of sorted) {
    legend.append(h('div', { class: 'legend-item' },
      h('span', { class: 'legend-swatch', style: { '--tape': tapeVar(members, member.id) } }),
      h('span', {}, member.name),
      h('span', { class: 'legend-value' }, String(scores[member.id] || 0))));
  }
  card.append(legend);
  wrap.append(card);

  // Spread between the busiest and least busy person — the one number that
  // actually answers "is this fair?".
  const values = active.map((m) => scores[m.id] || 0);
  const spread = Math.max(...values) - Math.min(...values);
  wrap.append(h('div', { class: 'card' },
    h('div', { class: 'row row-between' },
      h('div', {},
        h('div', { class: 'eyebrow' }, 'Spread'),
        h('div', { class: 'small muted' },
          spread <= 3
            ? 'Well balanced. No action needed.'
            : 'Worth a look — the next few weeks should even this out.')),
      h('div', { style: { 'font-family': 'var(--font-mono)', 'font-size': '1.5rem' } }, String(spread)))));

  return wrap;
}

/* ---------------------------------------------------------------------------
   ACTIVITY VIEW — the "no sneakiness" record
   ------------------------------------------------------------------------ */

export function activityView(ctx) {
  const { log } = ctx;
  const wrap = h('div', {});

  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, 'Everything that\'s changed'),
      h('h2', {}, 'Activity'))));

  if (!log.length) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'Nothing\'s happened yet'),
      h('p', {}, 'Every edit, swap and redraw gets recorded here, with who did it.')));
    return wrap;
  }

  const card = h('div', { class: 'card card-flush' });
  for (const entry of log) {
    const { before, after, context } = entry.details || {};

    card.append(h('div', { class: 'log-entry' },
      h('div', { class: 'log-head' },
        h('span', { class: 'log-who' }, entry.personName || 'Someone'),
        h('span', { class: 'log-when' }, timeAgo(entry.timestamp))),
      h('div', { class: 'log-detail' }, `${entry.action}${context ? ` · ${context}` : ''}`),
      (before || after)
        ? h('div', { class: 'log-change' },
            before ? h('span', { class: 'log-before' }, before) : null,
            before && after ? ' → ' : null,
            after ? h('span', { class: 'log-after' }, after) : null)
        : null));
  }

  wrap.append(card);
  return wrap;
}

/* ---------------------------------------------------------------------------
   MANAGE VIEW — people and chores
   ------------------------------------------------------------------------ */

export function manageView(ctx) {
  const { members, chores, actions } = ctx;
  const wrap = h('div', {});

  /* People ---------------------------------------------------------------- */

  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, `${members.filter((m) => m.active).length} in the rotation`),
      h('h2', {}, 'Family')),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openPerson(null) },
      icon('plus', 15), 'Add')));

  if (!members.length) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'No one here yet'),
      h('p', {}, 'Add everyone who does chores.')));
  } else {
    const list = h('div', { class: 'card card-flush' });
    for (const member of members) {
      list.append(h('div', { class: `list-row${member.active ? '' : ' is-off'}` },
        personDot(members, member.id, member.name),
        h('div', { class: 'grow' },
          h('div', { style: { 'font-weight': '600' } }, member.name),
          h('div', { class: 'small muted' },
            [member.active ? 'In the rotation' : 'Paused',
             member.ageRestricted ? 'skips adults-only chores' : null]
              .filter(Boolean).join(' · '))),
        h('button', { class: 'btn btn-quiet btn-sm', onclick: () => actions.openPerson(member) },
          'Edit')));
    }
    wrap.append(list);
  }

  /* Chores ---------------------------------------------------------------- */

  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, `${chores.filter((c) => c.active).length} in rotation`),
      h('h2', {}, 'Chores')),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openChore(null) },
      icon('plus', 15), 'Add')));

  if (!chores.length) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'No chores yet'),
      h('p', {}, 'Add them with a weight — higher means more of a pain to do.')));
  } else {
    const list = h('div', { class: 'card card-flush' });
    for (const chore of [...chores].sort((a, b) => b.weight - a.weight)) {
      list.append(h('div', { class: `list-row${chore.active ? '' : ' is-off'}` },
        h('span', { class: 'weight-tag', style: { 'font-size': '0.82rem', padding: '3px 7px' } },
          String(chore.weight)),
        h('div', { class: 'grow' },
          h('div', { style: { 'font-weight': '600' } }, chore.name),
          h('div', { class: 'small muted' },
            [chore.frequency === 'daily' ? 'Rotates daily' : 'One person all week',
             chore.adultOnly ? 'adults only' : null,
             chore.active ? null : 'paused'].filter(Boolean).join(' · '))),
        h('button', { class: 'btn btn-quiet btn-sm', onclick: () => actions.openChore(chore) },
          'Edit')));
    }
    wrap.append(list);
  }

  wrap.append(h('p', { class: 'small muted', style: { 'margin-top': '16px' } },
    'Weights are relative — a chore weighted 3 counts for three times as much as a chore weighted 1. '
    + 'Changing a weight only affects future weeks; past weeks keep the weight they were drawn up with.'));

  wrap.append(h('div', { class: 'row', style: { 'margin-top': '18px' } },
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openIdentity() },
      'Change who I am')));

  return wrap;
}

/* ---------------------------------------------------------------------------
   SHEETS
   ------------------------------------------------------------------------ */

/** Pick a person for a chore (or a single day of one). */
export function reassignSheet({ week, assignment, day, members, current, onPick }) {
  const chore = { adultOnly: assignment.adultOnly };

  return openSheet(() => [
    h('h2', {}, assignment.choreName),
    h('p', { class: 'sheet-sub' },
      day ? `${DAY_LABELS[day]} · who's doing it?` : 'All week · who\'s doing it?'),
    h('div', { class: 'pick-list' },
      members.map((member) => {
        const eligible = isEligible(member, chore, week.unavailable || []);
        return h('button', {
          class: `pick${eligible ? '' : ' is-disabled'}`,
          'aria-pressed': String(member.id === current),
          disabled: !eligible,
          onclick: () => { closeSheet(); onPick(member.id); },
        },
          personDot(members, member.id, member.name),
          h('span', { class: 'grow' }, member.name),
          h('span', { class: 'small muted' },
            member.id === current ? 'Doing it'
              : !member.active ? 'Paused'
              : (week.unavailable || []).includes(member.id) ? 'Away'
              : member.ageRestricted && assignment.adultOnly ? 'Adults only'
              : ''));
      })),
  ]);
}

/** Choose who's around before drawing up a week. */
export function generateSheet({ weekId, members, existing, onConfirm }) {
  const away = new Set();

  return openSheet((close) => {
    const list = h('div', { class: 'pick-list' },
      members.filter((m) => m.active).map((member) =>
        h('button', {
          class: 'pick',
          'aria-pressed': 'false',
          onclick: (event) => {
            const button = event.currentTarget;
            if (away.has(member.id)) away.delete(member.id); else away.add(member.id);
            button.setAttribute('aria-pressed', String(away.has(member.id)));
            button.querySelector('.pick-state').textContent =
              away.has(member.id) ? 'Away' : 'Here';
          },
        },
          personDot(members, member.id, member.name),
          h('span', { class: 'grow' }, member.name),
          h('span', { class: 'pick-state small muted' }, 'Here'))));

    return [
      h('h2', {}, existing ? 'Redraw this week' : 'Draw up this week'),
      h('p', { class: 'sheet-sub' },
        existing
          ? 'This replaces the current list, including any changes made by hand.'
          : `Chores for ${formatWeekRange(weekId)}. Tap anyone who's away.`),
      list,
      h('button', {
        class: 'btn btn-block',
        style: { 'margin-top': '14px' },
        onclick: () => { close(); onConfirm([...away]); },
      }, icon('wand', 17), existing ? 'Redraw' : 'Draw up the week'),
    ];
  });
}

/** Two-step swap: pick one chore, then the one to swap it with. */
export function swapSheet({ week, members, onSwap }) {
  const slots = [];
  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      for (const day of DAYS) {
        slots.push({
          key: `${a.choreId}:${day}`,
          assignment: a, day,
          memberId: a.days?.[day] || null,
          label: `${a.choreName} · ${DAY_LABELS[day].slice(0, 3)}`,
        });
      }
    } else {
      slots.push({
        key: a.choreId, assignment: a, day: null,
        memberId: a.assignedTo || null,
        label: `${a.choreName} · all week`,
      });
    }
  }

  let first = null;

  const render = (close) => {
    const heading = first
      ? 'Now pick what to swap it with'
      : 'Pick the chore to swap';

    const list = h('div', { class: 'pick-list' },
      slots.map((slot) => {
        const disabled = first && slot.key === first.key;
        return h('button', {
          class: `pick${disabled ? ' is-disabled'  : ''}`,
          'aria-pressed': String(first?.key === slot.key),
          disabled,
          onclick: () => {
            if (!first) {
              first = slot;
              refresh(close);
            } else {
              close();
              onSwap(first, slot);
            }
          },
        },
          personDot(members, slot.memberId, members.find((m) => m.id === slot.memberId)?.name || '?'),
          h('span', { class: 'grow' }, slot.label),
          h('span', { class: 'small muted' },
            members.find((m) => m.id === slot.memberId)?.name || 'Nobody'));
      }));

    return [
      h('h2', {}, 'Swap chores'),
      h('p', { class: 'sheet-sub' }, heading + '. The change is instant — no approval needed.'),
      list,
      first
        ? h('button', {
            class: 'btn btn-ghost btn-block',
            style: { 'margin-top': '12px' },
            onclick: () => { first = null; refresh(close); },
          }, 'Start over')
        : null,
    ];
  };

  const refresh = () => openSheet((close) => render(close));
  return openSheet((close) => render(close));
}

/** Calendar export: everyone, or just one person. */
export function exportSheet({ week, members, onExport }) {
  return openSheet((close) => [
    h('h2', {}, 'Add to calendar'),
    h('p', { class: 'sheet-sub' },
      'Downloads a calendar file to open in your calendar app. It\'s a snapshot — '
      + 'if chores change later, download it again.'),
    h('div', { class: 'pick-list' },
      h('button', {
        class: 'pick',
        onclick: () => { close(); onExport(null); },
      }, h('span', { class: 'grow' }, 'Everyone\'s chores')),
      members.filter((m) => m.active).map((member) =>
        h('button', {
          class: 'pick',
          onclick: () => { close(); onExport(member.id); },
        },
          personDot(members, member.id, member.name),
          h('span', { class: 'grow' }, `Just ${member.name}`)))),
  ]);
}

/** Who's using this device? Remembered per device, used to sign activity. */
export function identitySheet({ members, current, onPick, dismissible = true }) {
  return openSheet((close) => [
    h('h2', {}, 'Who are you?'),
    h('p', { class: 'sheet-sub' },
      'This signs your name against anything you change, so everyone can see who did what.'),
    h('div', { class: 'pick-list' },
      members.filter((m) => m.active).map((member) =>
        h('button', {
          class: 'pick',
          'aria-pressed': String(member.id === current),
          onclick: () => { close(); onPick(member.id); },
        },
          personDot(members, member.id, member.name),
          h('span', { class: 'grow' }, member.name)))),
    dismissible
      ? h('button', { class: 'btn btn-ghost btn-block', style: { 'margin-top': '12px' }, onclick: close },
          'Not now')
      : null,
  ]);
}

/** Add or edit a person. */
export function personSheet({ member, onSave, onDelete }) {
  const editing = !!member;
  const draft = {
    name: member?.name || '',
    active: member ? member.active !== false : true,
    ageRestricted: !!member?.ageRestricted,
  };

  return openSheet((close) => {
    const nameInput = h('input', {
      class: 'input', type: 'text', value: draft.name,
      placeholder: 'e.g. Sam', maxlength: '40',
      oninput: (e) => { draft.name = e.target.value; },
    });

    return [
      h('h2', {}, editing ? 'Edit person' : 'Add someone'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput),
        h('label', { class: 'switch' },
          h('div', {},
            h('div', { style: { 'font-weight': '600' } }, 'In the rotation'),
            h('div', { class: 'small muted' }, 'Turn off to pause someone without deleting them')),
          h('input', {
            type: 'checkbox', checked: draft.active,
            onchange: (e) => { draft.active = e.target.checked; },
          })),
        h('label', { class: 'switch' },
          h('div', {},
            h('div', { style: { 'font-weight': '600' } }, 'Skips adults-only chores'),
            h('div', { class: 'small muted' }, 'For younger kids')),
          h('input', {
            type: 'checkbox', checked: draft.ageRestricted,
            onchange: (e) => { draft.ageRestricted = e.target.checked; },
          })),
        h('button', {
          class: 'btn btn-block',
          onclick: () => {
            if (!draft.name.trim()) { nameInput.focus(); return; }
            close();
            onSave(draft);
          },
        }, editing ? 'Save changes' : 'Add to the family'),
        editing
          ? h('button', {
              class: 'btn btn-quiet btn-block btn-danger',
              onclick: () => { close(); onDelete(); },
            }, icon('trash', 16), 'Remove from the family')
          : null),
    ];
  });
}

/** Add or edit a chore. */
export function choreSheet({ chore, onSave, onDelete }) {
  const editing = !!chore;
  const draft = {
    name: chore?.name || '',
    weight: chore?.weight ?? 1,
    frequency: chore?.frequency || 'weekly',
    adultOnly: !!chore?.adultOnly,
    active: chore ? chore.active !== false : true,
  };

  return openSheet((close) => {
    const nameInput = h('input', {
      class: 'input', type: 'text', value: draft.name,
      placeholder: 'e.g. Clean the bathroom', maxlength: '60',
      oninput: (e) => { draft.name = e.target.value; },
    });

    const freq = h('div', { class: 'seg-control' });
    const weeklyBtn = h('button', { 'aria-pressed': String(draft.frequency === 'weekly') },
      'One person all week');
    const dailyBtn = h('button', { 'aria-pressed': String(draft.frequency === 'daily') },
      'Rotates daily');

    const setFreq = (value) => {
      draft.frequency = value;
      weeklyBtn.setAttribute('aria-pressed', String(value === 'weekly'));
      dailyBtn.setAttribute('aria-pressed', String(value === 'daily'));
    };
    weeklyBtn.addEventListener('click', () => setFreq('weekly'));
    dailyBtn.addEventListener('click', () => setFreq('daily'));
    freq.append(weeklyBtn, dailyBtn);

    return [
      h('h2', {}, editing ? 'Edit chore' : 'Add a chore'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Chore'), nameInput),

        h('div', { class: 'field' },
          h('label', {}, 'How much of a pain is it?'),
          h('input', {
            class: 'input', type: 'number', min: '0', step: '0.5', value: String(draft.weight),
            oninput: (e) => { draft.weight = e.target.value; },
          }),
          h('div', { class: 'small muted' },
            'Relative to your other chores. Most families end up using 1 to 5.')),

        h('div', { class: 'field' }, h('label', {}, 'How often'), freq),

        h('label', { class: 'switch' },
          h('div', {},
            h('div', { style: { 'font-weight': '600' } }, 'Adults only'),
            h('div', { class: 'small muted' }, 'Never given to anyone marked as skipping these')),
          h('input', {
            type: 'checkbox', checked: draft.adultOnly,
            onchange: (e) => { draft.adultOnly = e.target.checked; },
          })),

        h('label', { class: 'switch' },
          h('div', {},
            h('div', { style: { 'font-weight': '600' } }, 'In the rotation'),
            h('div', { class: 'small muted' }, 'Turn off to pause it without deleting')),
          h('input', {
            type: 'checkbox', checked: draft.active,
            onchange: (e) => { draft.active = e.target.checked; },
          })),

        h('button', {
          class: 'btn btn-block',
          onclick: () => {
            if (!draft.name.trim()) { nameInput.focus(); return; }
            close();
            onSave(draft);
          },
        }, editing ? 'Save changes' : 'Add chore'),

        editing
          ? h('button', {
              class: 'btn btn-quiet btn-block btn-danger',
              onclick: () => { close(); onDelete(); },
            }, icon('trash', 16), 'Delete chore')
          : null),
    ];
  });
}
