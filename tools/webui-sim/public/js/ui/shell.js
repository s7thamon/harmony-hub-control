/* Shared Melodious UI pieces: snackbar, bottom sheets, the sub-page top
   bar, and small markup helpers that match the app's Compose
   components (ScreenTitle, ListGroup/ListRow, IconTile, StatusDot). */

import { escapeHtml } from "../setup-kit.js";
import { icon } from "./icons.js";

export { escapeHtml, icon };

/* -- Snackbar (one at a time, errors linger) ------------------------------ */

let snackTimer = null;

export function snackbar(text, { error = false } = {}) {
  const host = document.getElementById("snackbars");
  if (!host) return;
  clearTimeout(snackTimer);
  host.innerHTML = `<div class="snackbar${error ? " is-error" : ""}" role="${error ? "alert" : "status"}">${escapeHtml(text)}</div>`;
  snackTimer = setTimeout(() => {
    host.innerHTML = "";
  }, error ? 8000 : 4000);
}

/* -- Bottom sheet (centred card on wide screens) --------------------------- */

/**
 * Open a modal sheet. `render(content, close)` fills it. Esc, the scrim and
 * close() all dismiss it; the dialog element is removed afterwards.
 */
export function openSheet({ label, render, onClose, className = "" }) {
  const dialog = document.createElement("dialog");
  dialog.className = `sheet${className ? ` ${className}` : ""}`;
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = `<div class="sheet-body"><div class="sheet-handle" aria-hidden="true"></div><div class="sheet-content"></div></div>`;
  const content = dialog.querySelector(".sheet-content");
  const close = () => {
    if (dialog.open) dialog.close();
  };
  // A click that lands on the dialog itself (not its body) hit the scrim.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClose?.();
  });
  document.body.appendChild(dialog);
  render(content, close);
  dialog.showModal();
  return { dialog, content, close };
}

/* -- Sub-page top bar --------------------------------------------------------- */

/** Show the back-arrow bar (title, parent hash, optional action buttons HTML),
    or hide it with null. Action clicks are handled by the view that owns them. */
export function setAppBar(bar) {
  const el = document.getElementById("appbar");
  const app = document.getElementById("app");
  if (!el || !app) return;
  if (!bar) {
    el.hidden = true;
    app.classList.remove("is-subpage");
    return;
  }
  el.hidden = false;
  app.classList.add("is-subpage");
  el.querySelector("#appbarBack").setAttribute("href", `#${bar.back}`);
  el.querySelector("#appbarTitle").textContent = bar.title;
  el.querySelector("#appbarActions").innerHTML = bar.actions ?? "";
}

/* -- Haptics: a short tick where the browser can vibrate (Android) ------------ */

export function vibrate() {
  try {
    navigator.vibrate?.(8);
  } catch (_) {}
}

/* -- Markup helpers (escape everything that comes from the hub) -------------- */

export function screenTitle(title, { subtitle = "", action = "" } = {}) {
  return `<div class="m-title-row">
      <div class="m-title-text"><h2 class="m-title">${escapeHtml(title)}</h2>${subtitle}</div>
      ${action}
    </div>`;
}

export function sectionLabel(text, { muted = false } = {}) {
  return `<h3 class="m-section${muted ? " is-muted" : ""}">${escapeHtml(text)}</h3>`;
}

export function iconTile(name, { size = 44, tone = "" } = {}) {
  return `<span class="m-tile${tone ? ` m-tile--${tone}` : ""}" style="--tile:${size}px">${icon(name, { size: Math.round(size * 0.5) })}</span>`;
}

export function statusDot(live) {
  return `<span class="m-dot${live ? " is-live" : ""}" aria-hidden="true"></span>`;
}

/** One list row; pass `href` for a link row or `attrs` for a button row. */
export function listRow({ title, subtitle = "", leading = "", trailing = "", chevron = false, href = "", attrs = "" }) {
  const inner = `${leading}
      <span class="m-row-text">
        <span class="m-row-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="m-row-sub">${escapeHtml(subtitle)}</span>` : ""}
      </span>
      ${trailing}
      ${chevron ? icon("keyboard_arrow_right", { cls: "m-row-chevron" }) : ""}`;
  if (href) return `<a class="m-row" href="${escapeHtml(href)}" ${attrs}>${inner}</a>`;
  if (attrs) return `<button type="button" class="m-row" ${attrs}>${inner}</button>`;
  return `<div class="m-row">${inner}</div>`;
}

export function spinner(label = "") {
  return `<span class="m-spinner" role="progressbar" ${label ? `aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'}></span>`;
}
