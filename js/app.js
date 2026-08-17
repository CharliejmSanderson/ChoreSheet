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
  saveWeek, updateWeekAssignments, updateWeekFields, removeWeek, logActivity, resetLocal,
  addInfoBlock, updateInfoBlock, removeInfoBlock, setInfoBoxOrder, reorderInfoBlocks,
} from './store.js';

import {
  generateWeek, weekIdFor, nextWeekId, prevWeekId,
  formatWeekRange, DAY_LABELS, unassignedCount, restrictionOf,
} from './schedule.js';

import { toggleChecklistItem as toggleItemLogic, moveItem, blockTypeMeta, localId as infoLocalId } from './info.js';
import { APP_VERSION } from './config.js';
import { downloadICS } from './ics.js';
import { h, clear, icon, personDot, toast, confirmSheet } from './ui.js';

import {
  weekView, tasksView, activityView, manageView,
  reassignSheet, generateSheet, swapSheet, exportSheet,
  identitySheet, personSheet, choreSheet,
  pickChoreForInfoSheet, pickBlockTypeSheet,
  noteBlockSheet, checklistBlockSheet, stepsBlockSheet, supplyBlockSheet, commentsBlockSheet,
} from './views.js';

/* ---------------------------------------------------------------------------
   STATE — only what the screen needs. Everything real lives in the store.
   ------------------------------------------------------------------------ */

const state = {
  tab: 'week',
  weekId: weekIdFor(),
  mineOnly: false,
  tasksTab: 'info',
  // Set right after a redraw so the week view can offer one step back. Holds
  // a snapshot of the week as it was immediately before that redraw.
  undo: null,
};

const TABS = [
  { id: 'week', label: 'Week', icon: 'week' },
  { id: 'tasks', label: 'Tasks', icon: 'balance' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'manage', label: 'Manage', icon: 'manage' },
];

/* ---------------------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------------------ */

const nameOf = (id) => data.members.find((m) => m.id === id)?.name || 'Nobody';
const nameOfChore = (id) => data.chores.find((c) => c.id === id)?.name || 'a chore';

/** Deep copy the assignments before editing, so we never mutate cached state. */
const cloneAssignments = (week) => JSON.parse(JSON.stringify(week.assignments || []));

function context() {
  return {
    members: data.members,
    chores: data.chores,
    weeks: data.weeks,
    log: data.log,
    infoBlocks: data.infoBlocks,
    infoBoxOrder: data.infoBoxOrder,
    who: getWho(),
    state,
    actions,
  };
}

/* ---------------------------------------------------------------------------
   ACTIONS
   ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
   BATCHING RENDERS

   A single action often causes more than one underlying write — saving a
   week's assignments AND logging it to the activity feed, say — and each
   write, once confirmed, tells the app to re-render. Left alone that's 2-3
   visible re-renders back to back for what should look like one update.

   Wrapping an action with `batched` suppresses those in-between renders while
   it's running, and does exactly one, right when it's actually finished —
   whether that render was going to be triggered by the store's own change
   notifications or by the action's own code, both funnel through the same
   suppression check, so it doesn't matter how many writes happened inside.

   This only wraps actions that talk to the store. Pure navigation (switching
   tabs, moving between weeks) never touches it and stays instant.
   ------------------------------------------------------------------------ */

let suppressRender = 0;

function batched(fn) {
  return async (...args) => {
    suppressRender++;
    try {
      await fn(...args);
    } catch (err) {
      // A write that fails silently is worse than one that fails loudly —
      // this is exactly how the missing Firestore rules for the Info tab
      // went unnoticed: the sheet closed as if it worked, nothing was
      // actually saved, and there was no signal anything had gone wrong.
      console.error(err);
      toast('Couldn\'t save that — check your connection and try again');
    } finally {
      suppressRender--;
      if (suppressRender === 0) render();
    }
  };
}

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

  setTasksTab(tab) {
    state.tasksTab = tab;
    render();
  },

  /* --- Drawing up a week ------------------------------------------------ */

  openGenerate(weekId) {
    const existing = data.weeks.find((w) => w.id === weekId);
    generateSheet({
      weekId,
      members: data.members,
      existing,
      onConfirm: (unavailable, fill) =>
        actions.runGenerate(weekId, unavailable, !!existing, fill),
    });
  },

  openRegenerate(weekId) {
    actions.openGenerate(weekId);
  },

  /**
   * Draw up a week.
   * fill 'auto'   — share everything out
   *      'manual' — create it empty, to be allocated by hand
   */
  async runGenerate(weekId, unavailable, isRedraw, fill = 'auto') {
    // If this overwrites an existing week, keep a copy so it can be undone —
    // a redraw is the one destructive action in the app with no other way back.
    const previous = isRedraw ? data.weeks.find((w) => w.id === weekId) : null;
    const undoSnapshot = previous
      ? {
          weekId,
          assignments: JSON.parse(JSON.stringify(previous.assignments || [])),
          unavailable: [...(previous.unavailable || [])],
        }
      : null;

    const week = generateWeek({
      weekId,
      chores: data.chores,
      members: data.members,
      unavailable,
      history: data.weeks.filter((w) => w.id !== weekId),
      fill,
    });

    week.generatedBy = whoName();
    await saveWeek(week);

    await logActivity({
      action: isRedraw
        ? 'Redrew the week'
        : (fill === 'manual' ? 'Started the week to allocate by hand' : 'Drew up the week'),
      context: formatWeekRange(weekId),
      after: unavailable.length ? `${unavailable.map(nameOf).join(', ')} marked away` : null,
      weekId,
    });

    state.weekId = weekId;
    state.undo = undoSnapshot;

    if (fill === 'manual') {
      toast('Empty week ready — tap a chore to allocate');
      return;
    }

    // A chore with nobody eligible would otherwise vanish quietly.
    const orphaned = unassignedCount(week);
    toast(orphaned
      ? 'Drawn up — some chores had nobody eligible'
      : (isRedraw ? 'Week redrawn' : 'Week drawn up'));
  },

  /** Puts a redrawn week back exactly as it was, one step, right after. */
  async undoRedraw() {
    const snap = state.undo;
    if (!snap) return;
    state.undo = null;

    await updateWeekFields(snap.weekId, {
      assignments: snap.assignments,
      unavailable: snap.unavailable,
    });
    await logActivity({
      action: 'Undid a redraw',
      context: formatWeekRange(snap.weekId),
      weekId: snap.weekId,
    });

    toast('Redraw undone');
  },

  /** Removes a week completely — including from the fairness history, so
   *  it stops counting toward who's due for what. Confirm first, same as
   *  deleting a person or a chore; only the actual write gets batched, so a
   *  long pause on the confirmation doesn't hold up anyone else's phone. */
  async deleteWeek(weekId) {
    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    const ok = await confirmSheet({
      title: 'Delete this week?',
      body: `This removes ${formatWeekRange(weekId)} completely, including from everyone's `
        + 'history — it will no longer count toward who\'s due for what. This can\'t be undone.',
      confirmLabel: 'Delete week',
      danger: true,
    });
    if (!ok) return;

    if (state.undo?.weekId === weekId) state.undo = null;
    await batched(async () => {
      await removeWeek(weekId);
      await logActivity({
        action: 'Deleted a week',
        context: formatWeekRange(weekId),
      });
      toast('Week deleted');
    })();
  },

  /** Finish a part-allocated week, keeping every choice already made. */
  async fillRest(weekId) {
    state.undo = null;
    const existing = data.weeks.find((w) => w.id === weekId);
    if (!existing) return;

    const filled = generateWeek({
      weekId,
      chores: data.chores,
      members: data.members,
      unavailable: existing.unavailable || [],
      history: data.weeks.filter((w) => w.id !== weekId),
      fill: 'rest',
      preserve: existing,
    });

    const before = unassignedCount(existing);
    await updateWeekAssignments(weekId, filled.assignments);
    await logActivity({
      action: 'Filled in the rest of the week',
      context: formatWeekRange(weekId),
      after: `${before - unassignedCount(filled)} chores allocated automatically`,
      weekId,
    });

    toast('Rest of the week filled in');
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
      chores: data.chores,
      current,
      onPick: (memberId) => actions.reassign(weekId, assignment.choreId, day, memberId, current),
    });
  },

  async reassign(weekId, choreId, day, memberId, previous) {
    if (memberId === previous) return;
    if (state.undo?.weekId === weekId) state.undo = null;

    const week = data.weeks.find((w) => w.id === weekId);
    if (!week) return;

    const assignments = cloneAssignments(week);
    const target = assignments.find((a) => a.choreId === choreId);
    if (!target) return;

    if (day) target.days[day] = memberId;
    else target.assignedTo = memberId;

    await updateWeekAssignments(weekId, assignments);
    await logActivity({
      action: memberId ? 'Reassigned a chore' : 'Unallocated a chore',
      context: `${target.choreName}${day ? ` · ${DAY_LABELS[day]}` : ''}`,
      before: nameOf(previous),
      after: memberId ? nameOf(memberId) : 'nobody',
      weekId,
    });

    toast(memberId
      ? `${target.choreName} → ${nameOf(memberId)}`
      : `${target.choreName} left unallocated`);
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
    if (state.undo?.weekId === weekId) state.undo = null;

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
      onSave: batched(async (draft) => {
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
      }),
      onDelete: async () => {
        // The confirm dialog can sit open indefinitely — only the actual
        // write afterward should suppress renders, not the waiting.
        const ok = await confirmSheet({
          title: `Remove ${member.name}?`,
          body: 'Past weeks keep their record, but they won\'t be given any new chores. '
            + 'To keep them in the history and pause them instead, turn off "In the rotation".',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!ok) return;

        await batched(async () => {
          await removeMember(member.id);
          await logActivity({ action: 'Removed a person', before: member.name });
          if (getWho() === member.id) setWho(null);
          toast(`${member.name} removed`);
        })();
      },
    });
  },

  /* --- Chores ----------------------------------------------------------- */

  openChore(chore) {
    choreSheet({
      chore,
      onSave: batched(async (draft) => {
        const payload = {
          name: draft.name.trim(),
          notes: (draft.notes || '').trim(),
          frequency: draft.frequency,
          restriction: draft.restriction,
          active: draft.active,
        };

        if (chore) {
          const changes = [];
          if (payload.name !== chore.name) changes.push(`renamed from ${chore.name}`);
          if (payload.notes !== (chore.notes || '')) {
            changes.push(payload.notes ? `note: "${payload.notes}"` : 'note removed');
          }
          if (payload.frequency !== chore.frequency) changes.push(`now ${payload.frequency}`);
          if (payload.restriction !== restrictionOf(chore)) {
            const labels = { none: 'anyone', adultOnly: 'adults only', childOnly: 'kids only' };
            changes.push(`now ${labels[payload.restriction]}`);
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
            after: `${payload.name} (${payload.frequency})`,
          });
          toast('Chore added');
        }
      }),
      onDelete: async () => {
        const ok = await confirmSheet({
          title: `Delete ${chore.name}?`,
          body: 'Weeks already drawn up keep it. To stop it appearing in future weeks '
            + 'without deleting it, turn off "In the rotation" instead.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;

        await batched(async () => {
          await removeChore(chore.id);
          await logActivity({ action: 'Deleted a chore', before: chore.name });
          toast('Chore deleted');
        })();
      },
    });
  },

  /* --- Identity --------------------------------------------------------- */

  openIdentity(dismissible = true, onAfterPick) {
    identitySheet({
      members: data.members,
      current: getWho(),
      dismissible,
      onPick: (memberId) => {
        setWho(memberId);
        render();
        toast(`Hello, ${nameOf(memberId)}`);
        if (onAfterPick) onAfterPick();
      },
    });
  },

  /* --- Info (Tasks > Info) ----------------------------------------------
     Two-step add flow: pick a chore (skipped if one's already known, e.g.
     from a box's own "+"), then pick what kind of thing to add, then a
     type-specific form. The actual write only happens once the form's own
     Save is pressed — identity was already confirmed before any of this
     opened, so nothing further down the chain needs to re-check it. */

  openAddInfoBlock(choreId = null) {
    if (choreId) {
      pickBlockTypeSheet({ onPick: (type) => actions.openInfoBlockForm(choreId, type, null) });
      return;
    }
    pickChoreForInfoSheet({
      chores: data.chores,
      onPick: (pickedChoreId) => pickBlockTypeSheet({
        onPick: (type) => actions.openInfoBlockForm(pickedChoreId, type, null),
      }),
    });
  },

  openEditInfoBlock(block) {
    actions.openInfoBlockForm(block.choreId, block.type, block);
  },

  openInfoBlockForm(choreId, type, block) {
    const sheetFor = {
      note: noteBlockSheet, checklist: checklistBlockSheet, steps: stepsBlockSheet,
      supply: supplyBlockSheet, comments: commentsBlockSheet,
    }[type];
    if (!sheetFor) return;

    sheetFor({
      block,
      onSave: batched(async (payload) => {
        if (block) {
          await updateInfoBlock(block.id, payload);
          await logActivity({
            action: 'Edited info',
            context: `${nameOfChore(block.choreId)} · ${payload.label || blockTypeMeta(block.type)?.label}`,
          });
          toast('Saved');
        } else {
          const order = data.infoBlocks.filter((b) => b.choreId === choreId).length;
          const base = {
            choreId, type, order,
            createdBy: whoName(), createdAt: new Date().toISOString(),
            ...payload,
          };
          if (type === 'checklist') Object.assign(base, { checkedItems: [], checkedPeriodKey: '', checkedBy: {} });
          if (type === 'comments') Object.assign(base, { entries: [] });

          await addInfoBlock(base);
          await logActivity({
            action: 'Added info',
            context: `${nameOfChore(choreId)} · ${blockTypeMeta(type)?.label}`,
          });
          toast('Added');
        }
      }),
      onDelete: block ? async () => {
        const ok = await confirmSheet({
          title: 'Delete this?',
          body: 'This removes it for everyone. If it\'s the only thing here, the whole box '
            + 'disappears from the Info page too.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;

        await batched(async () => {
          await removeInfoBlock(block.id);
          await logActivity({
            action: 'Removed info',
            context: `${nameOfChore(block.choreId)} · ${block.label || blockTypeMeta(block.type)?.label}`,
          });
          toast('Deleted');
        })();
      } : undefined,
    });
  },

  /** Ticking, commenting, and adjusting supply are quick, frequent taps —
   *  deliberately NOT written to the global Activity feed, or a checklist
   *  used four times a day would drown out everything else there. Who did
   *  what is still visible, just locally: a ticked item shows who ticked it,
   *  a comment shows its author, right on the block itself. */

  async toggleChecklistItem(block, itemId) {
    const patch = toggleItemLogic(block, itemId, whoName());
    await updateInfoBlock(block.id, patch);
  },

  async adjustSupply(block, delta) {
    const quantity = Math.max(0, (block.quantity || 0) + delta);
    await updateInfoBlock(block.id, { quantity });
  },

  async addComment(block, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry = { id: infoLocalId('c'), text: trimmed, author: whoName(), timestamp: new Date().toISOString() };
    await updateInfoBlock(block.id, { entries: [...(block.entries || []), entry] });
  },

  /** Reordering also skips the activity log — it's tidying, not a change
   *  anyone needs an audit trail for. */

  async moveInfoBox(choreId, fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= data.infoBoxOrder.length) return;
    await setInfoBoxOrder(moveItem(data.infoBoxOrder, fromIndex, toIndex));
  },

  async moveInfoBlock(choreId, blocksInBox, fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= blocksInBox.length) return;
    await reorderInfoBlocks(moveItem(blocksInBox, fromIndex, toIndex).map((b) => b.id));
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
   APPLY BATCHING

   These are the actions that write to the store and had their manual
   render() calls removed above — wrapping them here (rather than inline)
   keeps the full list in one place, the same way the identity list below
   does. This has to run BEFORE the identity-guard wrapping, so that guarded
   actions like fillRest end up as guard(batch(original)) — identity checked
   first, then the batched write.
   ------------------------------------------------------------------------ */

const BATCH_RENDER = [
  'reassign', 'swap', 'runGenerate', 'undoRedraw', 'fillRest',
  'toggleChecklistItem', 'adjustSupply', 'addComment', 'moveInfoBox', 'moveInfoBlock',
];

for (const name of BATCH_RENDER) {
  actions[name] = batched(actions[name]);
}

/* ---------------------------------------------------------------------------
   REQUIRE IDENTITY BEFORE EDITING

   Once at least one person exists in the family, every action that changes
   shared data has to know who's making the change — that's the whole point
   of the activity log. The one exception is adding the very first person(s):
   with nobody in the family yet, there's nobody to pick from, so that has to
   stay open or the app could never be set up in the first place.

   This wraps the relevant actions after the fact rather than guarding inside
   each one, so the full list of what requires identity is visible in one
   place instead of scattered through the file.
   ------------------------------------------------------------------------ */

const REQUIRES_IDENTITY = [
  'openReassign', 'openSwap', 'openGenerate', 'openRegenerate',
  'fillRest', 'undoRedraw', 'deleteWeek', 'openPerson', 'openChore',
  'openAddInfoBlock', 'openEditInfoBlock',
  'toggleChecklistItem', 'adjustSupply', 'addComment', 'moveInfoBox', 'moveInfoBlock',
];

for (const name of REQUIRES_IDENTITY) {
  const original = actions[name];
  actions[name] = (...args) => {
    const familyExists = data.members.some((m) => m.active);
    if (!familyExists || getWho()) { original(...args); return; }
    actions.openIdentity(true, () => original(...args));
  };
}

/* ---------------------------------------------------------------------------
   RENDER

   The topbar and tab bar are built ONCE and then patched in place — only their
   small changing details (the who-button, which tab is active) get updated.
   Only the main content area is torn down and rebuilt each time. Previously
   the whole app — header, nav, everything — was destroyed and recreated on
   every single change, which is what caused the visible flash: for a moment
   the entire screen was blank before it repainted.
   ------------------------------------------------------------------------ */

const app = document.getElementById('app');
let topbarEl = null;
let whoBtnEl = null;
let mainEl = null;
let tabbarEl = null;

function buildShell() {
  whoBtnEl = h('button', { class: 'who-btn', onclick: () => actions.openIdentity() });

  topbarEl = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('div', { class: 'brand' }, 'Chores', h('span', {}, 'family roster')),
      whoBtnEl));

  mainEl = h('main', { id: 'view' });

  tabbarEl = h('nav', { class: 'tabbar', 'aria-label': 'Sections' });
  for (const tab of TABS) {
    tabbarEl.append(h('button', {
      class: 'tab',
      'data-tab': tab.id,
      onclick: () => actions.setTab(tab.id),
    }, icon(tab.icon), h('span', {}, tab.label)));
  }

  clear(app);
  app.append(topbarEl, mainEl, tabbarEl);
}

function updateShell(ctx) {
  const member = data.members.find((m) => m.id === ctx.who);
  clear(whoBtnEl);
  whoBtnEl.append(
    member
      ? personDot(data.members, member.id, member.name)
      : h('span', { class: 'dot', style: { '--tape': 'var(--ink-3)' } }, '?'),
    member ? member.name : 'Who are you?');

  for (const btn of tabbarEl.querySelectorAll('.tab')) {
    if (btn.dataset.tab === state.tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function render() {
  if (!topbarEl) buildShell();

  const ctx = context();
  updateShell(ctx);

  clear(mainEl);

  // Only shown while Firebase hasn't been set up — the data isn't shared yet,
  // and someone needs to know that before they rely on it.
  if (mode === 'local') {
    mainEl.append(h('div', { class: 'banner' },
      icon('warn', 17),
      h('div', {},
        h('strong', {}, 'Preview mode. '),
        'This data stays on this device and isn\'t shared with anyone. '
        + 'Add your Firebase details in js/config.js to sync the family.')));
  }

  if (state.tab === 'week') mainEl.append(weekView(ctx));
  else if (state.tab === 'tasks') mainEl.append(tasksView(ctx));
  else if (state.tab === 'activity') mainEl.append(activityView(ctx));
  else mainEl.append(manageView(ctx));
}

/* ---------------------------------------------------------------------------
   BOOT
   ------------------------------------------------------------------------ */

async function boot() {
  console.log(`Chores v${APP_VERSION}`);
  onChange(() => { if (suppressRender === 0) render(); });
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

// Exported purely so tests can exercise the batching/error-handling logic
// directly, without needing to fake a Firestore failure through the whole
// app. Nothing in production imports from this file, so this has no effect
// on the running app itself.
export { batched };