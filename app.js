/* ============================================================================
   app.js — startup, navigation, and every action the buttons trigger.

   Flow: load data -> render -> user taps something -> an action writes to the
   store -> the store tells us data changed -> render again. There's no partial
   updating; the screen is rebuilt each time, which is fast enough here and
   removes a whole class of "the display is out of sync" bugs.
   ========================================================================== */

import {
  initStore, onChange, data, mode,
  getWho, setWho, whoName,
  addMember, updateMember, removeMember,
  addChore, updateChore, removeChore,
  saveWeek, updateWeekAssignments, logActivity, resetLocal,
} from './store.js';

import {
  generateWeek, weekIdFor, nextWeekId, prevWeekId,
  formatWeekRange, DAY_LABELS,
} from './schedule.js';

import { downloadICS } from './ics.js';
import { h, clear, icon, personDot, toast, confirmSheet } from './ui.js';

import {
  weekView, balanceView, activityView, manageView,
  reassignSheet, generateSheet, swapSheet, exportSheet,
  identitySheet, personSheet, choreSheet,
} from './views.js';

/* ---------------------------------------------------------------------------
   STATE — only what the screen needs. Everything real lives in the store.
   ------------------------------------------------------------------------ */

const state = {
  tab: 'week',
  weekId: weekIdFor(),
  mineOnly: false,
};

const TABS = [
  { id: 'week', label: 'Week', icon: 'week' },
  { id: 'balance', label: 'Balance', icon: 'balance' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'manage', label: 'Manage', icon: 'manage' },
];

/* ---------------------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------------------ */

const nameOf = (id) => data.members.find((m) => m.id === id)?.name || 'Nobody';

/** Deep copy the assignments before editing, so we never mutate cached state. */
const cloneAssignments = (week) => JSON.parse(JSON.stringify(week.assignments || []));

function context() {
  return {
    members: data.members,
    chores: data.chores,
    weeks: data.weeks,
    log: data.log,
    who: getWho(),
    state,
    actions,
  };
}

/* ---------------------------------------------------------------------------
   ACTIONS
   ------------------------------------------------------------------------ */

const actions = {
  setTab(tab) {
    state.tab = tab;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  },

  stepWeek(direction) {
    state.weekId = direction > 0 ? nextWeekId(state.weekId) : prevWeekId(state.weekId);
    render();
  },

  setMineOnly(value) {
    state.mineOnly = value;
    render();
  },

  /* --- Drawing up a week ------------------------------------------------ */

  openGenerate(weekId) {
    const existing = data.weeks.find((w) => w.id === weekId);
    generateSheet({
      weekId,
      members: data.members,
      existing,
      onConfirm: (unavailable) => actions.runGenerate(weekId, unavailable, !!existing),
    });
  },

  openRegenerate(weekId) {
    actions.openGenerate(weekId);
  },

  async runGenerate(weekId, unavailable, isRedraw) {
    const week = generateWeek({
      weekId,
      chores: data.chores,
      members: data.members,
      unavailable,
      history: data.weeks.filter((w) => w.id !== weekId),
    });

    week.generatedBy = whoName();

    // Anything left unassigned means nobody was eligible — worth saying out
    // loud rather than letting a chore quietly vanish.
    const orphaned = week.assignments.filter((a) =>
      a.type === 'weekly' ? !a.assignedTo : Object.values(a.days || {}).some((v) => !v));

    await saveWeek(week);
    await logActivity({
      action: isRedraw ? 'Redrew the week' : 'Drew up the week',
      context: formatWeekRange(weekId),
      after: unavailable.length
        ? `${unavailable.map(nameOf).join(', ')} marked away`
        : null,
      weekId,
    });

    state.weekId = weekId;
    render();

    toast(orphaned.length
      ? 'Drawn up — some chores had nobody eligible'
      : (isRedraw ? 'Week redrawn' : 'Week drawn up'));
  },

  /* --- Reassigning ------------------------------------------------------ */

  openReassign(weekId, assignment, day) {
    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    const current = day ? assignment.days?.[day] : assignment.assignedTo;

    reassignSheet({
      week,
      assignment,
      day,
      members: data.members,
      current,
      onPick: (memberId) => actions.reassign(weekId, assignment.choreId, day, memberId, current),
    });
  },

  async reassign(weekId, choreId, day, memberId, previous) {
    if (memberId === previous) return;

    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    const assignments = cloneAssignments(week);
    const target = assignments.find((a) => a.choreId === choreId);
    if (!target) return;

    if (day) target.days[day] = memberId;
    else target.assignedTo = memberId;

    await updateWeekAssignments(weekId, assignments);
    await logActivity({
      action: 'Reassigned a chore',
      context: `${target.choreName}${day ? ` · ${DAY_LABELS[day]}` : ''}`,
      before: nameOf(previous),
      after: nameOf(memberId),
      weekId,
    });

    render();
    toast(`${target.choreName} → ${nameOf(memberId)}`);
  },

  /* --- Swapping --------------------------------------------------------- */

  openSwap(weekId) {
    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    swapSheet({
      week,
      members: data.members,
      onSwap: (a, b) => actions.swap(weekId, a, b),
    });
  },

  async swap(weekId, slotA, slotB) {
    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    const assignments = cloneAssignments(week);
    const read = (slot) => {
      const record = assignments.find((x) => x.choreId === slot.assignment.choreId);
      return slot.day ? record.days[slot.day] : record.assignedTo;
    };
    const write = (slot, memberId) => {
      const record = assignments.find((x) => x.choreId === slot.assignment.choreId);
      if (slot.day) record.days[slot.day] = memberId;
      else record.assignedTo = memberId;
    };

    const personA = read(slotA);
    const personB = read(slotB);
    write(slotA, personB);
    write(slotB, personA);

    await updateWeekAssignments(weekId, assignments);
    await logActivity({
      action: 'Swapped two chores',
      context: `${slotA.label} ↔ ${slotB.label}`,
      before: `${nameOf(personA)} / ${nameOf(personB)}`,
      after: `${nameOf(personB)} / ${nameOf(personA)}`,
      weekId,
    });

    render();
    toast('Swapped');
  },

  /* --- Calendar --------------------------------------------------------- */

  openExport(weekId) {
    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    exportSheet({
      week,
      members: data.members,
      onExport: (memberId) => {
        downloadICS(week, data.members, { memberId });
        toast('Calendar file downloaded');
      },
    });
  },

  /* --- People ----------------------------------------------------------- */

  openPerson(member) {
    personSheet({
      member,
      onSave: async (draft) => {
        if (member) {
          const changes = [];
          if (draft.name !== member.name) changes.push(`name ${member.name} → ${draft.name}`);
          if (draft.active !== member.active) changes.push(draft.active ? 'back in the rotation' : 'paused');
          if (draft.ageRestricted !== member.ageRestricted) {
            changes.push(draft.ageRestricted ? 'now skips adults-only chores' : 'can do adults-only chores');
          }
          await updateMember(member.id, draft);
          if (changes.length) {
            await logActivity({
              action: 'Edited a person',
              context: draft.name,
              after: changes.join(', '),
            });
          }
          toast('Saved');
        } else {
          await addMember(draft.name);
          await logActivity({ action: 'Added a person', after: draft.name.trim() });
          toast(`${draft.name.trim()} added`);
        }
        render();
      },
      onDelete: async () => {
        const ok = await confirmSheet({
          title: `Remove ${member.name}?`,
          body: 'Past weeks keep their record, but they won\'t be given any new chores. '
            + 'To keep them in the history and pause them instead, turn off "In the rotation".',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!ok) return;

        await removeMember(member.id);
        await logActivity({ action: 'Removed a person', before: member.name });
        if (getWho() === member.id) setWho(null);
        render();
        toast(`${member.name} removed`);
      },
    });
  },

  /* --- Chores ----------------------------------------------------------- */

  openChore(chore) {
    choreSheet({
      chore,
      onSave: async (draft) => {
        const payload = {
          name: draft.name.trim(),
          weight: Number(draft.weight) || 0,
          frequency: draft.frequency,
          adultOnly: draft.adultOnly,
          active: draft.active,
        };

        if (chore) {
          const changes = [];
          if (payload.name !== chore.name) changes.push(`renamed from ${chore.name}`);
          if (payload.weight !== chore.weight) changes.push(`weight ${chore.weight} → ${payload.weight}`);
          if (payload.frequency !== chore.frequency) changes.push(`now ${payload.frequency}`);
          if (payload.adultOnly !== chore.adultOnly) {
            changes.push(payload.adultOnly ? 'now adults only' : 'no longer adults only');
          }
          if (payload.active !== chore.active) changes.push(payload.active ? 'back in rotation' : 'paused');

          await updateChore(chore.id, payload);
          if (changes.length) {
            await logActivity({
              action: 'Edited a chore',
              context: payload.name,
              after: changes.join(', '),
            });
          }
          toast('Saved');
        } else {
          await addChore(payload);
          await logActivity({
            action: 'Added a chore',
            after: `${payload.name} (weight ${payload.weight}, ${payload.frequency})`,
          });
          toast('Chore added');
        }
        render();
      },
      onDelete: async () => {
        const ok = await confirmSheet({
          title: `Delete ${chore.name}?`,
          body: 'Weeks already drawn up keep it. To stop it appearing in future weeks '
            + 'without deleting it, turn off "In the rotation" instead.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;

        await removeChore(chore.id);
        await logActivity({ action: 'Deleted a chore', before: chore.name });
        render();
        toast('Chore deleted');
      },
    });
  },

  /* --- Identity --------------------------------------------------------- */

  openIdentity(dismissible = true) {
    identitySheet({
      members: data.members,
      current: getWho(),
      dismissible,
      onPick: (memberId) => {
        setWho(memberId);
        render();
        toast(`Hello, ${nameOf(memberId)}`);
      },
    });
  },

  async resetPreview() {
    const ok = await confirmSheet({
      title: 'Clear preview data?',
      body: 'This wipes the sample data on this device only. Nothing in Firebase is touched.',
      confirmLabel: 'Clear it',
      danger: true,
    });
    if (ok) { resetLocal(); render(); toast('Preview data cleared'); }
  },
};

/* ---------------------------------------------------------------------------
   RENDER
   ------------------------------------------------------------------------ */

const app = document.getElementById('app');

function render() {
  const ctx = context();

  clear(app);
  app.append(topbar(ctx));

  const main = h('main', { id: 'view' });

  // Only shown while Firebase hasn't been set up — the data isn't shared yet,
  // and someone needs to know that before they rely on it.
  if (mode === 'local') {
    main.append(h('div', { class: 'banner' },
      icon('warn', 17),
      h('div', {},
        h('strong', {}, 'Preview mode. '),
        'This data stays on this device and isn\'t shared with anyone. '
        + 'Add your Firebase details in js/config.js to sync the family.')));
  }

  if (state.tab === 'week') main.append(weekView(ctx));
  else if (state.tab === 'balance') main.append(balanceView(ctx));
  else if (state.tab === 'activity') main.append(activityView(ctx));
  else main.append(manageView(ctx));

  app.append(main);
  app.append(tabbar());
}

function topbar(ctx) {
  const who = ctx.who;
  const member = data.members.find((m) => m.id === who);

  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('div', { class: 'brand' }, 'Chores', h('span', {}, 'family roster')),
      h('button', {
        class: 'who-btn',
        onclick: () => actions.openIdentity(),
      },
        member
          ? personDot(data.members, member.id, member.name)
          : h('span', { class: 'dot', style: { '--tape': 'var(--ink-3)' } }, '?'),
        member ? member.name : 'Who are you?')));
}

function tabbar() {
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Sections' });

  for (const tab of TABS) {
    nav.append(h('button', {
      class: 'tab',
      'aria-current': state.tab === tab.id ? 'page' : null,
      onclick: () => actions.setTab(tab.id),
    }, icon(tab.icon), h('span', {}, tab.label)));
  }
  return nav;
}

/* ---------------------------------------------------------------------------
   BOOT
   ------------------------------------------------------------------------ */

async function boot() {
  onChange(render);
  await initStore();
  render();

  // First run: if nobody's said who they are and there are people to choose
  // from, ask. It's one tap and it makes the activity log meaningful.
  if (!getWho() && data.members.length > 1) {
    setTimeout(() => actions.openIdentity(true), 400);
  }
}

boot().catch((err) => {
  console.error(err);
  clear(app);
  app.append(h('main', {},
    h('div', { class: 'card empty' },
      h('h2', {}, 'The app couldn\'t start'),
      h('p', {}, 'Check the browser console for details. If you\'ve just added your '
        + 'Firebase settings, make sure every value in js/config.js was filled in.'))));
});

// Exposed for quick fiddling from the browser console; not used by the UI.
window.chores = { state, data, actions };
