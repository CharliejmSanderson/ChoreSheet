/* ============================================================================
   views.js — the four screens.

   Every view is a function taking a context object and returning a DOM node.
   Views never write data; they call functions on `ctx.actions`, which live in
   app.js. That keeps "what the screen looks like" apart from "what happens
   when you tap it".
   ========================================================================== */

import { h, clear, icon, personChip, personDot, tapeVar, timeAgo, openSheet, closeSheet } from './ui.js';
import {
  DAYS, DAY_LABELS, HISTORY_WEEKS,
  formatWeekRange, datesOfWeek, weekIdFor, computeCounts, countFor,
  isEligible, restrictionOf, toISODate, unassignedCount, totalJobs,
} from './schedule.js';
import {
  BLOCK_TYPES, RESET_CADENCES, blockTypeMeta, localId,
  checkedItemsNow, isItemChecked, checklistProgress,
  groupBlocksByChore, orderedChoreIds,
} from './info.js';

const RESTRICTION_LABEL = { adultOnly: 'Adults only', childOnly: 'Kids only' };

/**
 * A chore's note text, read LIVE from the current chore — not from the
 * snapshot saved into the week when it was drawn up.
 *
 * This is deliberately different from weight and restriction, which DO stay
 * frozen at generation time: those feed the fairness maths, so past weeks
 * have to keep whatever was true when they were calculated, or the numbers
 * would stop meaning anything. A note doesn't affect any calculation — it's
 * just reference text — so there's no correctness reason to freeze it, and
 * doing so only meant editing a note silently failed to update anything
 * already on screen. Falls back to the frozen copy only if the chore itself
 * has since been deleted, so old weeks don't just lose the note outright.
 */
function liveNote(chores, assignment) {
  const chore = chores.find((c) => c.id === assignment.choreId);
  return chore ? chore.notes : assignment.notes;
}

/* ---------------------------------------------------------------------------
   WEEK VIEW — the home screen
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

  // A redraw just happened to this exact week — offer one step back.
  if (state.undo?.weekId === week.id) {
    wrap.append(h('div', { class: 'banner', style: { 'align-items': 'center' } },
      icon('warn', 17),
      h('div', { class: 'grow' }, 'Week redrawn just now.'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { flex: 'none' },
        onclick: () => actions.undoRedraw(),
      }, 'Undo')));
  }

  // A part-filled week needs an obvious way to finish it off.
  const missing = unassignedCount(week);
  if (missing > 0) {
    wrap.append(h('div', { class: 'card', style: { 'border-color': 'var(--warn-line)' } },
      h('div', { class: 'row row-between wrap', style: { gap: '10px' } },
        h('div', { class: 'grow' },
          h('div', { style: { 'font-weight': '650' } },
            `${missing} of ${totalJobs(week)} still to allocate`),
          h('div', { class: 'small muted' },
            'Tap any chore to pick someone, or let the app finish the rest.')),
        h('button', {
          class: 'btn btn-sm',
          onclick: () => actions.fillRest(week.id),
        }, icon('wand', 15), 'Fill the rest'))));
  }

  if (week.unavailable?.length) {
    const names = week.unavailable
      .map((id) => members.find((m) => m.id === id)?.name)
      .filter(Boolean).join(', ');
    if (names) {
      wrap.append(h('div', { class: 'banner' },
        icon('warn', 17),
        h('div', {}, h('strong', {}, 'Away this week: '), names,
          h('div', { class: 'small', style: { 'margin-top': '2px' } },
            'They pick up more once they\'re back.'))));
    }
  }

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
        : 'Add some chores under Manage, then draw the week up again.')));
  } else {
    const list = h('div', { class: 'card card-flush' });
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
      class: 'nav-btn', 'aria-label': 'Previous week',
      onclick: () => actions.stepWeek(-1),
    }, icon('left')),
    h('div', { style: { 'text-align': 'center', flex: '1 1 auto', 'min-width': '0' } },
      h('div', { class: 'when' },
        isCurrent ? 'This week' : (state.weekId > weekIdFor() ? 'Coming up' : 'Past week')),
      h('h1', {}, formatWeekRange(state.weekId))),
    h('button', {
      class: 'nav-btn', 'aria-label': 'Next week',
      onclick: () => actions.stepWeek(1),
    }, icon('right')));
}

function notGeneratedYet(ctx) {
  const { state, actions, chores, members } = ctx;
  const ready = chores.filter((c) => c.active).length > 0
    && members.filter((m) => m.active).length > 0;

  return h('div', { class: 'card empty' },
    h('h2', {}, 'This week hasn\'t been drawn up'),
    h('p', {}, ready
      ? 'Share the chores out automatically, or pick who does what yourself.'
      : 'Add at least one person and one chore under Manage first.'),
    ready
      ? h('button', { class: 'btn', onclick: () => actions.openGenerate(state.weekId) },
          icon('wand', 17), 'Draw up this week')
      : h('button', { class: 'btn btn-ghost', onclick: () => actions.setTab('manage') },
          'Go to Manage'));
}

/** One chore. Weekly chores are a single tappable row; daily chores show a
 *  seven-day strip where each day can be reassigned on its own. */
function choreRow(ctx, week, assignment) {
  const { members, actions, state, chores } = ctx;

  // Who's eligible only matters when picking someone — showing "Adults only"
  // on every glance at the week just adds noise to the main screen.
  const meta = h('div', { class: 'chore-meta' },
    h('span', {}, assignment.type === 'daily' ? 'Different each day' : 'All week'));

  const noteText = liveNote(chores, assignment);
  const note = noteText
    ? h('div', { class: 'chore-note' }, noteText)
    : null;

  if (assignment.type === 'weekly') {
    return h('button', {
      class: 'chore-item',
      onclick: () => actions.openReassign(week.id, assignment, null),
    },
      h('div', { class: 'grow' },
        h('div', { class: 'chore-name' }, assignment.choreName),
        meta,
        note),
      personChip(members, assignment.assignedTo));
  }

  const today = toISODate(new Date());
  const dates = datesOfWeek(week.id);

  const strip = h('div', { class: 'day-strip' });
  for (const day of DAYS) {
    const memberId = assignment.days?.[day];
    const member = members.find((m) => m.id === memberId);

    strip.append(h('button', {
      class: `day-cell${dates[day] === today ? ' is-today' : ''}`,
      'aria-label': `${assignment.choreName}, ${DAY_LABELS[day]}: ${member?.name || 'nobody yet'}`,
      onclick: () => actions.openReassign(week.id, assignment, day),
    },
      h('span', { class: 'day-label' }, day[0].toUpperCase() + day[1]),
      member
        ? personDot(members, memberId, member.name)
        : h('span', { class: 'dot dot-empty' }, '+')));
  }

  return h('div', { class: 'chore-item chore-item-block' },
    h('div', { class: 'chore-name' }, assignment.choreName),
    meta,
    note,
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
      'Redraw week'),
    h('button', {
      class: 'btn btn-quiet btn-sm btn-danger',
      onclick: () => actions.deleteWeek(week.id),
    }, icon('trash', 15), 'Delete week'));
}

/* ---------------------------------------------------------------------------
   TASKS VIEW — who's done what, and how often
   ------------------------------------------------------------------------ */

/** The Tasks tab: a switcher between Info (this chore's own notes and
 *  checklists) and Data (the fairness tallies that already existed). Info is
 *  the default — it's what people actually open this tab to check day to
 *  day; Data is more of an occasional "is this still fair" glance. */
export function tasksView(ctx) {
  const { state, actions } = ctx;
  const sub = state.tasksTab || 'info';

  const wrap = h('div', {});
  wrap.append(h('div', { class: 'seg-control', style: { 'margin-bottom': '16px' } },
    h('button', { 'aria-pressed': String(sub === 'info'), onclick: () => actions.setTasksTab('info') },
      'Info'),
    h('button', { 'aria-pressed': String(sub === 'data'), onclick: () => actions.setTasksTab('data') },
      'Data')));

  wrap.append(sub === 'info' ? infoView(ctx) : dataView(ctx));
  return wrap;
}

function dataView(ctx) {
  const { members, chores, weeks } = ctx;
  const active = members.filter((m) => m.active);
  const counts = computeCounts(weeks, members, { historyWeeks: HISTORY_WEEKS });
  const grandTotal = active.reduce((sum, m) => sum + (counts[m.id]?.total || 0), 0);

  const wrap = h('div', {});
  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' },
        HISTORY_WEEKS > 0 ? `Last ${HISTORY_WEEKS} weeks` : 'All time'),
      h('h2', {}, 'Who\'s done what'))));

  if (active.length === 0 || grandTotal === 0) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'Nothing counted yet'),
      h('p', {}, 'Once a week has been drawn up, the tallies show here.')));
    return wrap;
  }

  /* Overall split, as one bar ------------------------------------------- */

  const card = h('div', { class: 'card' });
  const strip = h('div', {
    class: 'balance-strip', role: 'img',
    'aria-label': active.map((m) => `${m.name}: ${counts[m.id]?.total || 0} tasks`).join(', '),
  });

  for (const member of active) {
    const value = counts[member.id]?.total || 0;
    strip.append(h('div', {
      class: 'balance-seg',
      style: { '--tape': tapeVar(members, member.id), 'flex-grow': String(Math.max(value, 0.001)) },
      title: `${member.name}: ${value}`,
    }, value > 0 && grandTotal / active.length > 6 ? String(value) : ''));
  }

  const ticks = h('div', { class: 'balance-ticks', 'aria-hidden': 'true' });
  for (let i = 0; i < active.length; i++) ticks.append(h('div', { class: 'balance-tick' }));
  strip.append(ticks);

  card.append(strip);
  card.append(h('p', { class: 'small muted', style: { margin: '10px 0 0' } },
    'Total tasks done by each person. Dashes mark an even split.'));
  wrap.append(card);

  /* Per-person breakdown -------------------------------------------------- */

  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, 'Tap a name for the detail'),
      h('h2', {}, 'Every task, counted'))));

  const sorted = [...active].sort((a, b) => (counts[b.id]?.total || 0) - (counts[a.id]?.total || 0));

  for (const member of sorted) {
    const total = counts[member.id]?.total || 0;

    // Show current chores plus anything they've done that has since been
    // deleted, so old history doesn't silently vanish from the tallies.
    const knownIds = new Set(chores.map((c) => c.id));
    const rows = chores
      .map((c) => ({ id: c.id, name: c.name, active: c.active, n: countFor(counts, member.id, c.id) }))
      .concat(Object.keys(counts[member.id]?.byChore || {})
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, name: nameFromHistory(weeks, id), active: false, deleted: true,
                        n: countFor(counts, member.id, id) })))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

    const body = h('div', { class: 'count-list' });
    for (const row of rows) {
      body.append(h('div', { class: `count-row${row.n === 0 ? ' is-zero' : ''}` },
        h('span', { class: 'grow' }, row.name,
          row.deleted ? h('span', { class: 'small muted' }, ' (deleted)')
            : (!row.active ? h('span', { class: 'small muted' }, ' (paused)') : null)),
        h('span', { class: 'count-value' }, String(row.n))));
    }

    wrap.append(h('details', { class: 'person-block' },
      h('summary', {},
        personDot(members, member.id, member.name),
        h('span', { class: 'grow' }, member.name),
        h('span', { class: 'count-total' }, `${total}`),
        h('span', { class: 'summary-chevron', 'aria-hidden': 'true' }, icon('right', 15))),
      body));
  }

  return wrap;
}

/** Recover a deleted chore's name from the week records that still mention it. */
function nameFromHistory(weeks, choreId) {
  for (const week of weeks) {
    const found = (week.assignments || []).find((a) => a.choreId === choreId);
    if (found?.choreName) return found.choreName;
  }
  return 'Removed chore';
}

/* ---------------------------------------------------------------------------
   INFO VIEW — per-chore notes, checklists, steps, comments, supply levels
   ------------------------------------------------------------------------ */

function reorderButtons({ onUp, onDown, disableUp, disableDown, label }) {
  return h('div', { class: 'reorder-btns' },
    h('button', {
      class: 'reorder-btn', disabled: disableUp,
      'aria-label': `Move ${label} up`, onclick: onUp,
    }, icon('up', 14)),
    h('button', {
      class: 'reorder-btn', disabled: disableDown,
      'aria-label': `Move ${label} down`, onclick: onDown,
    }, icon('down', 14)));
}

export function infoView(ctx) {
  const { chores, infoBlocks, infoBoxOrder, actions } = ctx;
  const grouped = groupBlocksByChore(infoBlocks);
  const choreIds = orderedChoreIds(grouped, infoBoxOrder);

  const wrap = h('div', {});

  wrap.append(h('div', { class: 'row row-between', style: { 'margin-bottom': choreIds.length ? '14px' : '0' } },
    h('div', {},
      h('div', { class: 'eyebrow' }, 'Per-chore notes & checklists'),
      h('h2', {}, 'Info')),
    h('button', { class: 'btn btn-sm', onclick: () => actions.openAddInfoBlock() },
      icon('plus', 15), 'Add')));

  if (choreIds.length === 0) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'Nothing here yet'),
      h('p', {}, 'Add a note, a checklist, or anything else worth keeping with a chore.'),
      h('button', { class: 'btn', onclick: () => actions.openAddInfoBlock() },
        icon('plus', 16), 'Add info')));
    return wrap;
  }

  choreIds.forEach((choreId, index) => {
    const chore = chores.find((c) => c.id === choreId);
    const choreName = chore?.name || nameFromChoreHistory(ctx, choreId);
    const blocks = grouped.get(choreId) || [];

    const box = h('div', { class: 'info-box' },
      h('div', { class: 'info-box-head' },
        reorderButtons({
          label: choreName,
          disableUp: index === 0,
          disableDown: index === choreIds.length - 1,
          onUp: () => actions.moveInfoBox(choreId, index, index - 1),
          onDown: () => actions.moveInfoBox(choreId, index, index + 1),
        }),
        h('h3', { class: 'info-box-title' }, choreName),
        h('button', {
          class: 'info-add-btn', 'aria-label': `Add info to ${choreName}`,
          onclick: () => actions.openAddInfoBlock(choreId),
        }, icon('plus', 15))));

    blocks.forEach((block, blockIndex) => {
      box.append(infoBlockView(ctx, block, {
        disableUp: blockIndex === 0,
        disableDown: blockIndex === blocks.length - 1,
        onUp: () => actions.moveInfoBlock(choreId, blocks, blockIndex, blockIndex - 1),
        onDown: () => actions.moveInfoBlock(choreId, blocks, blockIndex, blockIndex + 1),
      }));
    });

    wrap.append(box);
  });

  return wrap;
}

/** A deleted chore's name, recovered from wherever it's still referenced. */
function nameFromChoreHistory(ctx, choreId) {
  return nameFromHistory(ctx.weeks, choreId);
}

function blockHeader(block, { disableUp, disableDown, onUp, onDown, onEdit }) {
  const meta = blockTypeMeta(block.type);
  return h('div', { class: 'info-block-head' },
    h('span', { class: 'info-block-type' }, icon(meta?.id === 'checklist' ? 'checklist'
      : meta?.id === 'steps' ? 'steps' : meta?.id === 'comments' ? 'comments'
      : meta?.id === 'supply' ? 'supply' : 'note', 15)),
    h('span', { class: 'grow info-block-label' }, block.label || meta?.label || ''),
    reorderButtons({ label: block.label || meta?.label || 'block', disableUp, disableDown, onUp, onDown }),
    h('button', { class: 'reorder-btn', 'aria-label': 'Edit', onclick: onEdit }, icon('edit', 14)));
}

function infoBlockView(ctx, block, reorder) {
  const { actions } = ctx;
  const onEdit = () => actions.openEditInfoBlock(block);

  if (block.type === 'note') {
    return h('div', { class: 'info-block' },
      blockHeader(block, { ...reorder, onEdit }),
      h('p', { class: 'info-block-text' }, block.text || ''));
  }

  if (block.type === 'steps') {
    const list = h('ol', { class: 'info-steps' });
    for (const step of block.steps || []) list.append(h('li', {}, step.text));
    return h('div', { class: 'info-block' }, blockHeader(block, { ...reorder, onEdit }), list);
  }

  if (block.type === 'checklist') {
    const { done, total } = checklistProgress(block);
    const list = h('div', { class: 'checklist' });
    for (const item of block.items || []) {
      const checked = isItemChecked(block, item.id);
      const by = checked ? block.checkedBy?.[item.id] : null;
      list.append(h('button', {
        class: `checklist-item${checked ? ' is-checked' : ''}`,
        onclick: () => actions.toggleChecklistItem(block, item.id),
      },
        h('span', { class: 'check-box', 'aria-hidden': 'true' }, checked ? icon('check', 13) : ''),
        h('span', { class: 'grow' }, item.text),
        by ? h('span', { class: 'small muted' }, by) : null));
    }
    return h('div', { class: 'info-block' },
      blockHeader(block, { ...reorder, onEdit }),
      h('div', { class: 'small muted', style: { margin: '2px 0 8px' } },
        `${done}/${total} done · resets ${block.resetCadence === 'never' ? 'never' : block.resetCadence}`),
      list);
  }

  if (block.type === 'supply') {
    return h('div', { class: 'info-block' },
      blockHeader(block, { ...reorder, onEdit }),
      h('div', { class: 'supply-row' },
        h('button', {
          class: 'supply-btn', 'aria-label': 'Decrease', disabled: block.quantity <= 0,
          onclick: () => actions.adjustSupply(block, -1),
        }, '–'),
        h('span', { class: 'supply-value' }, `${block.quantity} ${block.unit || ''}`.trim()),
        h('button', {
          class: 'supply-btn', 'aria-label': 'Increase',
          onclick: () => actions.adjustSupply(block, 1),
        }, '+')));
  }

  if (block.type === 'comments') {
    const list = h('div', { class: 'comment-list' });
    for (const entry of block.entries || []) {
      list.append(h('div', { class: 'comment-entry' },
        h('div', { class: 'row row-between' },
          h('span', { class: 'small', style: { 'font-weight': '650' } }, entry.author),
          h('span', { class: 'small muted' }, timeAgo(entry.timestamp))),
        h('p', { class: 'info-block-text', style: { margin: '2px 0 0' } }, entry.text)));
    }

    const input = h('input', { class: 'input', type: 'text', placeholder: 'Add a comment…', maxlength: '300' });
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      actions.addComment(block, text);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

    return h('div', { class: 'info-block' },
      blockHeader(block, { ...reorder, onEdit }),
      list.childNodes.length ? list : h('p', { class: 'small muted' }, 'No comments yet.'),
      h('div', { class: 'row', style: { 'margin-top': '8px', gap: '8px' } },
        input, h('button', { class: 'btn btn-sm', onclick: send }, 'Post')));
  }

  return h('div', { class: 'info-block' }, blockHeader(block, { ...reorder, onEdit }));
}

/* ---------------------------------------------------------------------------
   INFO SHEETS
   ------------------------------------------------------------------------ */

/** Step 1: which chore is this info for? */
export function pickChoreForInfoSheet({ chores, onPick }) {
  return openSheet((close) => [
    h('h2', {}, 'Add info to which chore?'),
    h('p', { class: 'sheet-sub' }, 'Pick a chore — you can add more than one thing to it later.'),
    h('div', { class: 'pick-list' },
      chores.length
        ? [...chores].sort((a, b) => a.name.localeCompare(b.name)).map((chore) =>
            h('button', { class: 'pick', onclick: () => { close(); onPick(chore.id); } },
              h('span', { class: 'grow' }, chore.name)))
        : h('p', { class: 'small muted' }, 'Add a chore under Manage first.')),
  ]);
}

/** Step 2: what kind of thing? */
export function pickBlockTypeSheet({ onPick }) {
  return openSheet((close) => [
    h('h2', {}, 'What kind of info?'),
    h('div', { class: 'pick-list' },
      BLOCK_TYPES.map((type) =>
        h('button', { class: 'pick', style: { 'align-items': 'flex-start' }, onclick: () => { close(); onPick(type.id); } },
          icon(type.id === 'checklist' ? 'checklist' : type.id === 'steps' ? 'steps'
            : type.id === 'comments' ? 'comments' : type.id === 'supply' ? 'supply' : 'note', 18),
          h('span', { class: 'grow' },
            h('div', { style: { 'font-weight': '650' } }, type.label),
            h('div', { class: 'small muted' }, type.description))))),
  ]);
}

/** Create or edit a note block. */
export function noteBlockSheet({ block, onSave, onDelete }) {
  const draft = { label: block?.label || '', text: block?.text || '' };

  return openSheet((close) => {
    const labelInput = h('input', {
      class: 'input', type: 'text', value: draft.label, maxlength: '60',
      placeholder: 'e.g. Where the filters are kept',
      oninput: (e) => { draft.label = e.target.value; },
    });
    const textInput = h('textarea', { class: 'input', rows: '5', maxlength: '2000', oninput: (e) => { draft.text = e.target.value; } });
    textInput.value = draft.text;

    return [
      h('h2', {}, block ? 'Edit note' : 'Add a note'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Title (optional)'), labelInput),
        h('div', { class: 'field' }, h('label', {}, 'Note'), textInput),
        h('button', {
          class: 'btn btn-block',
          onclick: () => { close(); onSave({ ...draft, label: draft.label.trim(), text: draft.text.trim() }); },
        }, 'Save'),
        block ? deleteBlockButton(close, onDelete) : null),
    ];
  });
}

/** Create or edit a checklist block. */
export function checklistBlockSheet({ block, onSave, onDelete }) {
  const draft = {
    label: block?.label || '',
    resetCadence: block?.resetCadence || 'daily',
    items: block?.items ? block.items.map((i) => ({ ...i })) : [],
  };

  return openSheet((close) => {
    const labelInput = h('input', {
      class: 'input', type: 'text', value: draft.label, maxlength: '60',
      placeholder: 'e.g. Feeding times',
      oninput: (e) => { draft.label = e.target.value; },
    });

    const cadenceBtns = {};
    const cadenceRow = h('div', { class: 'seg-control' });
    for (const c of RESET_CADENCES) {
      const btn = h('button', { 'aria-pressed': String(draft.resetCadence === c.id) }, c.label);
      btn.addEventListener('click', () => {
        draft.resetCadence = c.id;
        for (const [id, b] of Object.entries(cadenceBtns)) b.setAttribute('aria-pressed', String(id === c.id));
      });
      cadenceBtns[c.id] = btn;
      cadenceRow.append(btn);
    }

    const itemsList = h('div', { class: 'stack', style: { gap: '7px' } });
    const renderItems = () => {
      clear(itemsList);
      draft.items.forEach((item, index) => {
        const itemInput = h('input', {
          class: 'input', type: 'text', value: item.text, maxlength: '40', placeholder: `Item ${index + 1}`,
          oninput: (e) => { item.text = e.target.value; },
        });
        itemsList.append(h('div', { class: 'row', style: { gap: '8px' } },
          itemInput,
          h('button', {
            class: 'btn btn-quiet btn-sm', 'aria-label': 'Remove item',
            onclick: () => { draft.items.splice(index, 1); renderItems(); },
          }, icon('trash', 15))));
      });
    };
    renderItems();

    return [
      h('h2', {}, block ? 'Edit checklist' : 'Add a checklist'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Title'), labelInput),
        h('div', { class: 'field' }, h('label', {}, 'Resets'), cadenceRow),
        h('div', { class: 'field' },
          h('label', {}, 'Items'),
          itemsList,
          h('button', {
            class: 'btn btn-ghost btn-sm', style: { 'align-self': 'flex-start', 'margin-top': '4px' },
            onclick: () => { draft.items.push({ id: localId('item'), text: '' }); renderItems(); },
          }, icon('plus', 14), 'Add item')),
        h('button', {
          class: 'btn btn-block',
          onclick: () => {
            const items = draft.items.map((i) => ({ ...i, text: i.text.trim() })).filter((i) => i.text);
            if (!draft.label.trim() || items.length === 0) return;
            close();
            onSave({ label: draft.label.trim(), resetCadence: draft.resetCadence, items });
          },
        }, 'Save'),
        block ? deleteBlockButton(close, onDelete) : null),
    ];
  });
}

/** Create or edit a steps block. */
export function stepsBlockSheet({ block, onSave, onDelete }) {
  const draft = {
    label: block?.label || '',
    steps: block?.steps ? block.steps.map((s) => ({ ...s })) : [],
  };

  return openSheet((close) => {
    const labelInput = h('input', {
      class: 'input', type: 'text', value: draft.label, maxlength: '60',
      placeholder: 'e.g. Cleaning the filter',
      oninput: (e) => { draft.label = e.target.value; },
    });

    const stepsList = h('div', { class: 'stack', style: { gap: '7px' } });
    const renderSteps = () => {
      clear(stepsList);
      draft.steps.forEach((step, index) => {
        const stepInput = h('input', {
          class: 'input', type: 'text', value: step.text, maxlength: '120', placeholder: `Step ${index + 1}`,
          oninput: (e) => { step.text = e.target.value; },
        });
        stepsList.append(h('div', { class: 'row', style: { gap: '8px' } },
          h('span', { class: 'small muted', style: { flex: 'none', width: '18px' } }, String(index + 1)),
          stepInput,
          h('button', {
            class: 'btn btn-quiet btn-sm', 'aria-label': 'Remove step',
            onclick: () => { draft.steps.splice(index, 1); renderSteps(); },
          }, icon('trash', 15))));
      });
    };
    renderSteps();

    return [
      h('h2', {}, block ? 'Edit steps' : 'Add steps'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Title'), labelInput),
        h('div', { class: 'field' },
          h('label', {}, 'Steps, in order'),
          stepsList,
          h('button', {
            class: 'btn btn-ghost btn-sm', style: { 'align-self': 'flex-start', 'margin-top': '4px' },
            onclick: () => { draft.steps.push({ id: localId('step'), text: '' }); renderSteps(); },
          }, icon('plus', 14), 'Add step')),
        h('button', {
          class: 'btn btn-block',
          onclick: () => {
            const steps = draft.steps.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
            if (!draft.label.trim() || steps.length === 0) return;
            close();
            onSave({ label: draft.label.trim(), steps });
          },
        }, 'Save'),
        block ? deleteBlockButton(close, onDelete) : null),
    ];
  });
}

/** Create or edit a supply counter. */
export function supplyBlockSheet({ block, onSave, onDelete }) {
  const draft = {
    label: block?.label || '',
    unit: block?.unit || '',
    quantity: block?.quantity ?? 0,
  };

  return openSheet((close) => {
    const labelInput = h('input', {
      class: 'input', type: 'text', value: draft.label, maxlength: '60',
      placeholder: 'e.g. Cat food', oninput: (e) => { draft.label = e.target.value; },
    });
    const unitInput = h('input', {
      class: 'input', type: 'text', value: draft.unit, maxlength: '20',
      placeholder: 'e.g. days, bags, scoops', oninput: (e) => { draft.unit = e.target.value; },
    });
    const qtyInput = h('input', {
      class: 'input', type: 'number', value: String(draft.quantity), min: '0',
      oninput: (e) => { draft.quantity = Number(e.target.value) || 0; },
    });

    return [
      h('h2', {}, block ? 'Edit supply level' : 'Add a supply level'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Title'), labelInput),
        h('div', { class: 'field' }, h('label', {}, 'Starting amount'), qtyInput),
        h('div', { class: 'field' }, h('label', {}, 'Unit (optional)'), unitInput),
        h('button', {
          class: 'btn btn-block',
          onclick: () => {
            if (!draft.label.trim()) return;
            close();
            onSave({ label: draft.label.trim(), unit: draft.unit.trim(), quantity: draft.quantity });
          },
        }, 'Save'),
        block ? deleteBlockButton(close, onDelete) : null),
    ];
  });
}

/** Comments only need a title — entries are added afterward, on the block. */
export function commentsBlockSheet({ block, onSave, onDelete }) {
  const draft = { label: block?.label || 'Comments' };

  return openSheet((close) => {
    const labelInput = h('input', {
      class: 'input', type: 'text', value: draft.label, maxlength: '60',
      oninput: (e) => { draft.label = e.target.value; },
    });

    return [
      h('h2', {}, block ? 'Edit thread' : 'Add a comment thread'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Title'), labelInput),
        h('button', {
          class: 'btn btn-block',
          onclick: () => { close(); onSave({ label: draft.label.trim() || 'Comments' }); },
        }, 'Save'),
        block ? deleteBlockButton(close, onDelete) : null),
    ];
  });
}

function deleteBlockButton(close, onDelete) {
  return h('button', {
    class: 'btn btn-quiet btn-block btn-danger',
    onclick: () => { close(); onDelete(); },
  }, icon('trash', 16), 'Delete this');
}

/* ---------------------------------------------------------------------------
   ACTIVITY VIEW
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
   MANAGE VIEW
   ------------------------------------------------------------------------ */

export function manageView(ctx) {
  const { members, chores, actions } = ctx;
  const wrap = h('div', {});

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

  wrap.append(h('div', { class: 'section-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, `${chores.filter((c) => c.active).length} in rotation`),
      h('h2', {}, 'Chores')),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openChore(null) },
      icon('plus', 15), 'Add')));

  if (!chores.length) {
    wrap.append(h('div', { class: 'card empty' },
      h('h2', {}, 'No chores yet'),
      h('p', {}, 'Add the jobs that need doing each week.')));
  } else {
    const list = h('div', { class: 'card card-flush' });
    for (const chore of [...chores].sort((a, b) => a.name.localeCompare(b.name))) {
      const restriction = restrictionOf(chore);
      list.append(h('div', { class: `list-row${chore.active ? '' : ' is-off'}` },
        h('div', { class: 'grow' },
          h('div', { style: { 'font-weight': '600' } }, chore.name),
          h('div', { class: 'small muted' },
            [chore.frequency === 'daily' ? 'Rotates daily' : 'One person all week',
             restriction !== 'none' ? RESTRICTION_LABEL[restriction].toLowerCase() : null,
             chore.active ? null : 'paused'].filter(Boolean).join(' · ')),
          chore.notes ? h('div', { class: 'chore-note' }, chore.notes) : null),
        h('button', { class: 'btn btn-quiet btn-sm', onclick: () => actions.openChore(chore) },
          'Edit')));
    }
    wrap.append(list);
  }

  wrap.append(h('p', { class: 'small muted', style: { 'margin-top': '16px' } },
    'Chores are shared out by how many times each person has done them, so everyone '
    + 'ends up doing each job about the same number of times. See the Tasks tab for the running count.'));

  wrap.append(h('div', { class: 'row', style: { 'margin-top': '18px' } },
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => actions.openIdentity() },
      'Change who I am')));

  return wrap;
}

/* ---------------------------------------------------------------------------
   SHEETS
   ------------------------------------------------------------------------ */

/** Pick a person for a chore, or for one day of one. */
export function reassignSheet({ week, assignment, day, members, chores, current, onPick }) {
  const restriction = restrictionOf(assignment);
  const chore = { restriction };
  const noteText = liveNote(chores, assignment);

  return openSheet(() => [
    h('h2', {}, assignment.choreName),
    h('p', { class: 'sheet-sub' },
      day ? `${DAY_LABELS[day]} · who's doing it?` : 'All week · who\'s doing it?'),
    noteText
      ? h('div', { class: 'chore-note', style: { 'margin-bottom': '14px' } }, noteText)
      : null,
    h('div', { class: 'pick-list' },
      members.map((member) => {
        const eligible = isEligible(member, chore, week.unavailable || []);
        const restrictionReason =
          (restriction === 'adultOnly' && member.ageRestricted) ? 'Adults only'
          : (restriction === 'childOnly' && !member.ageRestricted) ? 'Kids only'
          : '';
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
              : restrictionReason));
      })),
    current
      ? h('button', {
          class: 'btn btn-quiet btn-block',
          style: { 'margin-top': '10px' },
          onclick: () => { closeSheet(); onPick(null); },
        }, 'Leave it unallocated')
      : null,
  ]);
}

/**
 * Draw up a week: choose who's away, then automatic or by hand.
 */
export function generateSheet({ weekId, members, existing, onConfirm }) {
  const away = new Set();

  return openSheet((close) => {
    const list = h('div', { class: 'pick-list' },
      members.filter((m) => m.active).map((member) =>
        h('button', {
          class: 'pick', 'aria-pressed': 'false',
          onclick: (event) => {
            const button = event.currentTarget;
            if (away.has(member.id)) away.delete(member.id); else away.add(member.id);
            button.setAttribute('aria-pressed', String(away.has(member.id)));
            button.querySelector('.pick-state').textContent = away.has(member.id) ? 'Away' : 'Here';
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
      h('div', { class: 'stack', style: { 'margin-top': '16px' } },
        h('button', {
          class: 'btn btn-block',
          onclick: () => { close(); onConfirm([...away], 'auto'); },
        }, icon('wand', 17), 'Share them out for me'),
        h('button', {
          class: 'btn btn-ghost btn-block',
          onclick: () => { close(); onConfirm([...away], 'manual'); },
        }, 'I\'ll allocate them myself'),
        h('p', { class: 'small muted', style: { margin: '2px 0 0', 'text-align': 'center' } },
          'Allocating yourself? You can hand out as many as you like, then let the '
          + 'app finish the rest.'),
        h('button', {
          class: 'btn btn-quiet btn-block',
          onclick: close,
        }, 'Cancel')),
    ];
  });
}

/** Two-step swap: pick one job, then the one to swap it with. */
export function swapSheet({ week, members, onSwap }) {
  const slots = [];
  for (const a of week.assignments || []) {
    if (a.type === 'daily') {
      for (const day of DAYS) {
        slots.push({
          key: `${a.choreId}:${day}`, assignment: a, day,
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
    const list = h('div', { class: 'pick-list' },
      slots.map((slot) => {
        const disabled = first && slot.key === first.key;
        const member = members.find((m) => m.id === slot.memberId);
        return h('button', {
          class: `pick${disabled ? ' is-disabled' : ''}`,
          'aria-pressed': String(first?.key === slot.key),
          disabled,
          onclick: () => {
            if (!first) { first = slot; refresh(); }
            else { close(); onSwap(first, slot); }
          },
        },
          member
            ? personDot(members, slot.memberId, member.name)
            : h('span', { class: 'dot dot-empty' }, '–'),
          h('span', { class: 'grow' }, slot.label),
          h('span', { class: 'small muted' }, member?.name || 'Nobody'));
      }));

    return [
      h('h2', {}, 'Swap chores'),
      h('p', { class: 'sheet-sub' },
        (first ? 'Now pick what to swap it with' : 'Pick the chore to swap')
        + '. The change is instant — no approval needed.'),
      list,
      first
        ? h('button', {
            class: 'btn btn-ghost btn-block', style: { 'margin-top': '12px' },
            onclick: () => { first = null; refresh(); },
          }, 'Start over')
        : null,
    ];
  };

  const refresh = () => openSheet((close) => render(close));
  return refresh();
}

/** Calendar export: everyone, or one person. */
export function exportSheet({ week, members, onExport }) {
  return openSheet((close) => [
    h('h2', {}, 'Add to calendar'),
    h('p', { class: 'sheet-sub' },
      'Downloads a calendar file to open in your calendar app. It\'s a snapshot — '
      + 'if chores change later, download it again.'),
    h('div', { class: 'pick-list' },
      h('button', { class: 'pick', onclick: () => { close(); onExport(null); } },
        h('span', { class: 'grow' }, 'Everyone\'s chores')),
      members.filter((m) => m.active).map((member) =>
        h('button', { class: 'pick', onclick: () => { close(); onExport(member.id); } },
          personDot(members, member.id, member.name),
          h('span', { class: 'grow' }, `Just ${member.name}`)))),
  ]);
}

/** Who's using this device? */
export function identitySheet({ members, current, onPick, dismissible = true }) {
  return openSheet((close) => [
    h('h2', {}, 'Who are you?'),
    h('p', { class: 'sheet-sub' },
      'This signs your name against anything you change, so everyone can see who did what.'),
    h('div', { class: 'pick-list' },
      members.filter((m) => m.active).map((member) =>
        h('button', {
          class: 'pick', 'aria-pressed': String(member.id === current),
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
            close(); onSave(draft);
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
    notes: chore?.notes || '',
    frequency: chore?.frequency || 'weekly',
    restriction: chore ? restrictionOf(chore) : 'none',
    active: chore ? chore.active !== false : true,
  };

  return openSheet((close) => {
    const nameInput = h('input', {
      class: 'input', type: 'text', value: draft.name,
      placeholder: 'e.g. Clean the bathroom', maxlength: '60',
      oninput: (e) => { draft.name = e.target.value; },
    });

    const notesInput = h('textarea', {
      class: 'input', rows: '2', maxlength: '200',
      placeholder: 'e.g. Must be done before 5pm',
      oninput: (e) => { draft.notes = e.target.value; },
    });
    notesInput.value = draft.notes;

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

    // A chore can't sensibly be restricted to adults AND to kids at once, so
    // this is one three-way choice rather than two independent switches.
    const anyoneBtn = h('button', { 'aria-pressed': String(draft.restriction === 'none') }, 'Anyone');
    const adultBtn = h('button', { 'aria-pressed': String(draft.restriction === 'adultOnly') }, 'Adults only');
    const kidBtn = h('button', { 'aria-pressed': String(draft.restriction === 'childOnly') }, 'Kids only');

    const setRestriction = (value) => {
      draft.restriction = value;
      anyoneBtn.setAttribute('aria-pressed', String(value === 'none'));
      adultBtn.setAttribute('aria-pressed', String(value === 'adultOnly'));
      kidBtn.setAttribute('aria-pressed', String(value === 'childOnly'));
    };
    anyoneBtn.addEventListener('click', () => setRestriction('none'));
    adultBtn.addEventListener('click', () => setRestriction('adultOnly'));
    kidBtn.addEventListener('click', () => setRestriction('childOnly'));

    return [
      h('h2', {}, editing ? 'Edit chore' : 'Add a chore'),
      h('div', { class: 'stack', style: { 'margin-top': '14px' } },
        h('div', { class: 'field' }, h('label', {}, 'Chore'), nameInput),

        h('div', { class: 'field' },
          h('label', {}, 'Note (optional)'),
          notesInput,
          h('div', { class: 'small muted' },
            'Shown with the chore every week — timings, instructions, anything worth remembering.')),

        h('div', { class: 'field' },
          h('label', {}, 'How often'),
          h('div', { class: 'seg-control' }, weeklyBtn, dailyBtn)),

        h('div', { class: 'field' },
          h('label', {}, 'Who can do it'),
          h('div', { class: 'seg-control' }, anyoneBtn, adultBtn, kidBtn),
          h('div', { class: 'small muted' },
            'Adults only skips anyone marked "skips adults-only chores". Kids only is the reverse — '
            + 'only given to people marked that way.')),

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
            close(); onSave(draft);
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