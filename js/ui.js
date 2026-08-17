/* ============================================================================
   ui.js — small shared pieces every view uses.

   No framework here on purpose: the whole app is a few hundred lines of DOM
   building, which keeps it deployable as plain static files with no build step.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   TINY DOM BUILDER

   h('div', { class: 'card' }, 'text', otherNode)
   Props starting with 'on' become event listeners; everything else is an
   attribute. `style` accepts an object.
   ------------------------------------------------------------------------ */

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        node.style.setProperty(prop, val);
      }
    } else if (key === 'html') {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------------------------------------------------------------------------
   ICONS — inline so there's no icon font or extra request to wait on.
   ------------------------------------------------------------------------ */

const PATHS = {
  week: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  balance: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  activity: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  manage: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.6"/><circle cx="15" cy="17" r="2.6"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 4l-3 3 3 3M4 7h11a4 4 0 014 4M17 20l3-3-3-3M20 17H9a4 4 0 01-4-4"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  wand: '<path d="M4 20L15 9M14 4l1 2.5L17.5 7 15 8l-1 2.5L13 8l-2.5-1L13 6zM19 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  warn: '<path d="M12 3l9 16H3zM12 9v5M12 17v.5"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 000-3L18 6a2.1 2.1 0 00-3 0L4.5 16.5V20z"/><path d="M13.5 7.5l3 3"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M8.5 12h7M8.5 15.5h7"/>',
  checklist: '<path d="M4 6h2M4 12h2M4 18h2"/><path d="M9 6h11M9 12h11M9 18h11"/>',
  steps: '<path d="M4 18h5v-4H4zM4 10h9V6H4z"/><path d="M15 8h5M15 16h5"/>',
  comments: '<path d="M4 5h16v11H8l-4 4z"/>',
  supply: '<path d="M6 3h12l1 4H5zM5 7h14v14H5z"/><path d="M9 11h6"/>',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] || '';
  return svg;
}

/* ---------------------------------------------------------------------------
   PERSON COLOURS

   Colour comes from position in the family list, so it stays put as long as
   the list order does. Eight colours, then it wraps.
   ------------------------------------------------------------------------ */

export const TAPE_COUNT = 8;

export function tapeVar(members, memberId) {
  const index = members.findIndex((m) => m.id === memberId);
  return `var(--tape-${(index < 0 ? 0 : index) % TAPE_COUNT})`;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** The round coloured initial badge. */
export function personDot(members, memberId, name) {
  return h('span', {
    class: 'dot',
    style: { '--tape': tapeVar(members, memberId) },
    'aria-hidden': 'true',
  }, initials(name));
}

/** Coloured name chip. Pass memberId `null` for the unassigned state. */
export function personChip(members, memberId) {
  const member = members.find((m) => m.id === memberId);

  if (!member) {
    return h('span', { class: 'chip chip-unassigned' },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, '–'),
      h('span', { class: 'chip-name' }, 'Nobody yet'));
  }

  return h('span', {
    class: 'chip',
    style: { '--tape': tapeVar(members, memberId) },
  },
    personDot(members, memberId, member.name),
    h('span', { class: 'chip-name' }, member.name));
}

/* ---------------------------------------------------------------------------
   BOTTOM SHEET

   Every edit happens in one of these rather than a new page, so nobody ever
   loses their place in the week list.
   ------------------------------------------------------------------------ */

let openSheetNode = null;
let savedScrollY = 0;

export function closeSheet() {
  if (openSheetNode) {
    openSheetNode.remove();
    openSheetNode = null;
    document.removeEventListener('keydown', onSheetKey);
    unlockBody();
  }
}

function onSheetKey(event) {
  if (event.key === 'Escape') closeSheet();
}

/** Freezes the page behind the sheet so a stray swipe can't reach it.
 *
 *  A translucent backdrop alone doesn't stop the page underneath from
 *  scrolling — on iOS Safari that lets a swipe "escape" the sheet and land on
 *  the real page, which can trigger Safari's own pull-to-refresh and reload
 *  the tab. Pinning the body in place with position:fixed is the standard fix;
 *  overscroll-behavior alone isn't reliably supported across iOS versions. */
function lockBody() {
  savedScrollY = window.scrollY;
  Object.assign(document.body.style, {
    position: 'fixed',
    top: `-${savedScrollY}px`,
    left: '0',
    right: '0',
  });
}

function unlockBody() {
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' });
  window.scrollTo(0, savedScrollY);
}

/** Makes `handle` a real drag-to-dismiss grip: follow the finger, and either
 *  dismiss or snap back depending on how far it travelled.
 *
 *  This listens on `window` for the move/up events, rather than relying on
 *  the handle capturing the pointer — pointer capture support has real gaps
 *  on iOS Safari, and when it doesn't work, the drag silently stops tracking
 *  the moment a finger moves past the handle's own small area. Listening on
 *  window sidesteps that entirely: once a drag starts, every subsequent move
 *  anywhere on screen is caught, with no capture API involved. */
function makeDraggable(panel, handle, onDismiss) {
  const DISMISS_AFTER = 90; // px of downward drag that counts as "let go"
  let startY = 0;
  let offset = 0;

  const onMove = (event) => {
    offset = Math.max(0, event.clientY - startY); // only allow dragging down
    panel.style.transform = `translateY(${offset}px)`;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    panel.style.transition = '';
    if (offset > DISMISS_AFTER) onDismiss();
    else panel.style.transform = '';
    offset = 0;
  };

  handle.addEventListener('pointerdown', (event) => {
    startY = event.clientY;
    panel.style.transition = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/**
 * Show a bottom sheet.
 * @param {Function} build  receives `close` and returns nodes to show
 */
export function openSheet(build) {
  closeSheet();

  const grip = h('div', { class: 'sheet-grip' });
  // A bigger invisible zone around the grip, so it's an easy target to catch
  // with a thumb rather than the few pixels the visible bar occupies.
  const dragHandle = h('div', { class: 'sheet-drag-handle' }, grip);

  const panel = h('div', {
    class: 'sheet', role: 'dialog', 'aria-modal': 'true',
    onclick: (e) => e.stopPropagation(),
  }, dragHandle);

  const backdrop = h('div', { class: 'sheet-backdrop', onclick: closeSheet }, panel);

  for (const node of [build(closeSheet)].flat(Infinity)) {
    if (node) panel.append(node);
  }

  document.body.append(backdrop);
  document.addEventListener('keydown', onSheetKey);
  openSheetNode = backdrop;
  lockBody();
  makeDraggable(panel, dragHandle, closeSheet);
  keepFocusedFieldVisible(panel);

  // Move focus in so keyboard and screen-reader users land inside the sheet.
  // No preventScroll here — that was the bug: suppressing the browser's own
  // scroll-into-view is exactly what let the keyboard cover the field on the
  // very first focus. A manual tap afterward worked fine because it never
  // went through this code path at all.
  const focusable = panel.querySelector('input, button, select');
  if (focusable) focusable.focus();

  return closeSheet;
}

/**
 * Keeps whichever field currently has focus visible above the on-screen
 * keyboard — for every input in the sheet, not just the one focused when it
 * opens. iOS doesn't reliably do this on its own inside a custom-scrolling
 * container, which is why it can happen on any field, in any sheet, not just
 * the first one. A short delay lets the keyboard's own animation start
 * before scrolling, since scrolling immediately can land the field in the
 * wrong place — the viewport hasn't finished resizing yet.
 */
function keepFocusedFieldVisible(panel) {
  panel.addEventListener('focusin', (event) => {
    const el = event.target;
    if (!el.matches('input, textarea, select')) return;

    setTimeout(() => {
      if (document.body.contains(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 300);
  });
}

/** A yes/no sheet. Resolves true if confirmed. */
export function confirmSheet({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeSheet();
      resolve(value);
    };

    openSheet(() => [
      h('h2', {}, title),
      body ? h('p', { class: 'sheet-sub' }, body) : null,
      h('div', { class: 'stack' },
        h('button', {
          class: `btn btn-block${danger ? ' btn-danger' : ''}`,
          style: danger ? { background: '#a11d2e', 'border-color': '#a11d2e', color: '#fff' } : {},
          onclick: () => finish(true),
        }, confirmLabel),
        h('button', {
          class: 'btn btn-ghost btn-block',
          onclick: () => finish(false),
        }, 'Cancel')),
    ]);

    // Closing by backdrop or Escape counts as "no".
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.sheet-backdrop')) {
        observer.disconnect();
        finish(false);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

/* ---------------------------------------------------------------------------
   TOAST
   ------------------------------------------------------------------------ */

let toastTimer = null;

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2600);
}

/* ---------------------------------------------------------------------------
   FORMATTING
   ------------------------------------------------------------------------ */

/** "just now" / "3h ago" / "12 Aug" */
export function timeAgo(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const seconds = (Date.now() - then.getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}