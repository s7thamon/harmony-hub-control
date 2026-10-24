/* On-screen buttons (#touch/<activityId>): the Harmony Touch's screen for one
   activity. Rename a button, change the command it sends, move it, add or
   remove one. Buttons keep their place on the screen unless moved; the
   number pad, the remote's buttons and gestures stay as they are. Saves go
   through /api/activity-save like every activity edit (touch-model). */

import * as api from "../api.js";
import * as hub from "../state.js";
import {
  LABEL_MAX,
  addButton,
  isChanged,
  moveButton,
  neighbourOf,
  readTouchScreen,
  removeButton,
  saveOutcome,
  setCommand,
  setLabel,
  touchSavePayload,
} from "./touch-model.js";
import {
  confirmDialog,
  escapeHtml,
  icon,
  iconTile,
  openSheet,
  setAppBar,
  snackbar,
  spinner,
} from "../ui/shell.js";
import { humanizeLabel } from "./remote-model.js";

/* A save publishes a new revision, and the Touch syncs by itself when it
   sees it. Its own Sync menu asks the cloud and fails offline. */
const SYNC_NOTE = "The Touch picks up the change by itself. Until it does, a button you moved or changed can run its new action under its old label.";

export function createTouchScreenView(section) {
  let activityId = "";
  let draft = null;
  let dirty = false;
  let saving = false;
  let saved = false; // a save went through since this screen opened
  let blocked = ""; // "error" | "missing"
  let sheet = null;
  let showToken = 0;

  section.innerHTML = `<div class="wiz touch" id="touchRoot"></div>`;
  const root = section.querySelector("#touchRoot");

  /* -- labels ------------------------------------------------------------------ */

  const activityName = () => hub.activityName(hub.activityById(activityId));

  function actionSummary(action) {
    if (action.kind === "command") {
      const device = hub.deviceById(action.deviceId);
      return `${device ? device.name : "Missing device"} · ${action.command}`;
    }
    if (action.kind === "sequence") return action.name ? `Runs the sequence “${action.name}”` : "Runs a sequence";
    if (action.kind === "activity") return `Starts ${hub.activityName(hub.activityById(action.activityId))}`;
    return "Works on the Touch only";
  }

  /* The activity's devices first, then the rest of the hub's. */
  function pickerDevices() {
    const roles = (hub.activityById(activityId)?.Roles ?? []).map((r) => String(r["DeviceId-"]));
    const all = hub.devices().filter((d) => d.commands.length);
    const rank = (d) => (roles.includes(d.id) ? roles.indexOf(d.id) : roles.length);
    return all.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map(({ d }) => d);
  }

  /* -- drawing ----------------------------------------------------------------- */

  function updateBar() {
    if (section.hidden) return;
    setAppBar({ title: "On-screen buttons", back: "activities", close: dirty, onBack: requestClose });
  }

  function keptNote() {
    const { numberPad, hardButtons, gestures, sequences } = draft.kept;
    const parts = [
      numberPad && `the number pad`,
      hardButtons && `${hardButtons} remote button${hardButtons === 1 ? "" : "s"}`,
      gestures && `${gestures} gesture${gestures === 1 ? "" : "s"}`,
      sequences && `${sequences} sequence${sequences === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (!parts.length) return "";
    const list = parts.length < 2 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    return `<p class="wiz-hint">This screen also has ${list}. They stay as they are.</p>`;
  }

  function rowMarkup(row) {
    const label = row.label || "No label";
    const position = `<span class="touch-slot" title="Slot ${row.slot}" aria-hidden="true">${row.slot + 1}</span>`;
    if (row.locked) {
      return `<div class="m-row touch-row is-locked">
          ${position}
          <span class="m-row-text">
            <span class="m-row-title">${escapeHtml(label)}</span>
            <span class="m-row-sub">${escapeHtml(actionSummary(row.action))} · kept as it is</span>
          </span>
        </div>`;
    }
    const up = neighbourOf(draft, row.key, -1);
    const down = neighbourOf(draft, row.key, 1);
    return `<div class="m-row touch-row">
        ${position}
        <button type="button" class="touch-main" data-edit="${escapeHtml(row.key)}" aria-haspopup="dialog">
          <span class="m-row-text">
            <span class="m-row-title">${escapeHtml(label)}</span>
            <span class="m-row-sub">${escapeHtml(actionSummary(row.action))}</span>
          </span>
        </button>
        <span class="touch-move">
          <button type="button" class="icon-btn" data-move="${escapeHtml(row.key)}" data-step="-1" aria-label="${escapeHtml(`Move ${label} up`)}"${up && !saving ? "" : " disabled"}>${icon("keyboard_arrow_up")}</button>
          <button type="button" class="icon-btn" data-move="${escapeHtml(row.key)}" data-step="1" aria-label="${escapeHtml(`Move ${label} down`)}"${down && !saving ? "" : " disabled"}>${icon("keyboard_arrow_down")}</button>
        </span>
      </div>`;
  }

  function bodyMarkup() {
    const intro = `<div class="wiz-intro"><h2 tabindex="-1">${escapeHtml(activityName())}</h2>
        <p>The buttons on the Harmony Touch's screen for this activity, in screen order. Tap one to rename it or change what it sends.</p></div>`;
    const syncNote = saved
      ? `<div class="notice notice-warn touch-sync" role="status"><strong>Saved to the hub.</strong> ${escapeHtml(SYNC_NOTE)}</div>`
      : "";
    if (!draft.canCreate) {
      return `${intro}<div class="m-empty">
          ${iconTile("info_outlined", { size: 64 })}
          <h2 class="m-empty-title">No Harmony Touch screen on this hub</h2>
          <p class="m-empty-body">On-screen buttons need a Harmony Touch that has synced with this hub at least once.</p>
        </div>`;
    }
    const list = draft.rows.length
      ? `<div class="m-list">${draft.rows.map(rowMarkup).join("")}</div>`
      : `<p class="list-note">No on-screen buttons yet.</p>`;
    return `${intro}${syncNote}${list}
      <button type="button" class="wiz-add" data-act="add" aria-haspopup="dialog"${saving ? " disabled" : ""}>${icon("add")}<span>Add a button</span></button>
      ${keptNote()}
      ${dirty ? `<p class="wiz-hint">${escapeHtml(`Nothing reaches the hub until you save. ${SYNC_NOTE}`)}</p>` : ""}`;
  }

  function footMarkup() {
    if (!draft.canCreate) return "";
    return `<div class="wiz-foot">
        <button type="button" class="btn btn-outlined" data-act="undo"${dirty && !saving ? "" : " disabled"}>Undo changes</button>
        <button type="button" class="btn btn-filled${saving ? " is-busy" : ""}" data-act="save"${dirty && !saving ? "" : " disabled"}${saving ? ' aria-busy="true"' : ""}>
          ${saving ? `${spinner()}Saving to hub…` : "Save to hub"}
        </button>
      </div>`;
  }

  function render() {
    updateBar();
    if (blocked || !draft) return;
    const focused = document.activeElement;
    const keep = root.contains(focused)
      ? ["data-edit", "data-move", "data-act"].find((attr) => focused.hasAttribute(attr))
      : null;
    const keepSelector = keep
      ? `[${keep}="${CSS.escape(focused.getAttribute(keep))}"]${focused.dataset.step ? `[data-step="${focused.dataset.step}"]` : ""}`
      : "";
    root.innerHTML = `<div class="wiz-body">${bodyMarkup()}</div>${footMarkup()}`;
    if (keepSelector) {
      const again = root.querySelector(keepSelector);
      // A move button turns off at either end; keep focus on the row's other one.
      if (again?.disabled && keep === "data-move") root.querySelector(`[data-move="${CSS.escape(focused.dataset.move)}"]:not(:disabled)`)?.focus();
      else again?.focus({ preventScroll: true });
    }
  }

  function renderBlocked(kind) {
    blocked = kind;
    updateBar();
    root.innerHTML = kind === "missing"
      ? `<div class="m-empty">
          ${iconTile("info_outlined", { size: 64 })}
          <h2 class="m-empty-title">This activity isn't on the hub any more</h2>
          <p class="m-empty-body">It may have been deleted from another screen.</p>
          <a class="btn btn-filled" href="#activities">Back to activities</a>
        </div>`
      : `<div class="m-empty">
          ${iconTile("wifi_off", { size: 64, tone: "error" })}
          <h2 class="m-empty-title">Can't reach your hub</h2>
          <p class="m-empty-body">${escapeHtml(hub.state.configError?.message || "The hub didn't answer.")}</p>
          <button type="button" class="btn btn-filled" data-act="retry">Try again</button>
        </div>`;
  }

  /* -- edits ------------------------------------------------------------------- */

  function apply(edit) {
    try {
      draft = edit(draft);
    } catch (error) {
      snackbar(error.message, { error: true });
      return false;
    }
    dirty = isChanged(hub.state.config, draft);
    render();
    return true;
  }

  /* One sheet adds a button or edits one: its label, then a device and one
     of its commands. Done (kept at the top while the commands scroll)
     applies; nothing reaches the hub until Save. */
  function openButtonSheet(key) {
    sheet?.close();
    const row = key ? draft.rows.find((r) => r.key === key) : null;
    const devices = pickerDevices();
    let label = row ? row.label : "";
    let labelTouched = Boolean(row);
    let pick = row?.action.kind === "command"
      ? { deviceId: row.action.deviceId, command: row.action.command, functionId: row.action.functionId }
      : null;
    let deviceId = devices.some((d) => d.id === pick?.deviceId) ? pick.deviceId : devices[0]?.id ?? "";
    let query = "";

    const opened = openSheet({
      label: row ? `Button ${row.label}` : "New button",
      className: "pick-sheet",
      onClose: () => {
        if (sheet === opened) sheet = null;
        if (!sheet) root.querySelector(key ? `[data-edit="${CSS.escape(key)}"]` : '[data-act="add"]')?.focus();
      },
      render: (content, close) => {
        content.innerHTML = `<div class="pick-top">
            <div class="pick-head">
              <h2 class="sheet-title" tabindex="-1" autofocus>${row ? "Edit button" : "New button"}</h2>
              ${row ? `<button type="button" class="btn btn-text is-destructive" data-sheet="remove">Remove</button>` : ""}
              <button type="button" class="btn btn-filled btn-sm" data-sheet="done">Done</button>
            </div>
            <div class="wiz-field">
              <label for="touchLabel">Label on the Touch</label>
              <input id="touchLabel" maxlength="${LABEL_MAX}" autocomplete="off" value="${escapeHtml(label)}">
            </div>
            <p class="pick-now" data-pick-now></p>
            <div class="pick-chips" role="group" aria-label="Device" data-pick-chips></div>
            <label class="search-field">${icon("search", { size: 22 })}<input type="search" data-pick-search placeholder="Search commands" aria-label="Search commands" autocomplete="off"></label>
          </div>
          <div class="pick-list" data-pick-list></div>`;
        const $ = (selector) => content.querySelector(selector);

        function drawTop() {
          $("[data-pick-now]").textContent = pick
            ? `Sends: ${actionSummary({ kind: "command", ...pick })}`
            : row && row.action.kind !== "command"
              ? `${actionSummary(row.action)}. Pick a command to send instead.`
              : "Pick the command it sends.";
          $("[data-pick-chips]").innerHTML = devices.map((d) => `<button type="button" class="chip" data-pick-device="${escapeHtml(d.id)}" aria-pressed="${d.id === deviceId}">${escapeHtml(d.name)}</button>`).join("");
          $('[data-sheet="done"]').disabled = !label.trim() || !(pick || row);
        }

        function drawList() {
          const device = devices.find((d) => d.id === deviceId);
          const q = query.trim().toLowerCase();
          const check = icon("check", { cls: "pick-check", label: "Current" });
          const rows = (device?.commands ?? [])
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => !q || c.name.toLowerCase().includes(q))
            .map(({ c, i }) => {
              const on = pick?.deviceId === deviceId && pick?.command === c.name;
              return `<button type="button" class="pick-row${on ? " is-current" : ""}" data-pick-command="${i}"><span>${escapeHtml(c.name)}</span>${on ? check : ""}</button>`;
            });
          $("[data-pick-list]").innerHTML = !device
            ? `<p class="list-note">This hub has no devices with commands yet.</p>`
            : rows.length
              ? rows.join("")
              : `<p class="list-note">Nothing matches “${escapeHtml(query.trim())}”.</p>`;
        }

        function done() {
          const ok = apply((d) => {
            if (!row) return addButton(d, { label, ...pick });
            let next = setLabel(d, row.key, label);
            if (pick) next = setCommand(next, row.key, pick);
            return next;
          });
          if (ok) close();
        }

        content.addEventListener("click", (event) => {
          const chip = event.target.closest("[data-pick-device]");
          if (chip) {
            deviceId = chip.dataset.pickDevice;
            drawTop();
            drawList();
            content.querySelector(".pick-row.is-current")?.scrollIntoView({ block: "center" });
            return;
          }
          const commandRow = event.target.closest("[data-pick-command]");
          if (commandRow) {
            const device = devices.find((d) => d.id === deviceId);
            const command = device?.commands[Number(commandRow.dataset.pickCommand)];
            if (!command) return;
            pick = { deviceId: device.id, command: command.name, functionId: command.functionId ?? 0 };
            // A new button is named after its first command until you type a name.
            if (!labelTouched) {
              label = humanizeLabel(command.name).slice(0, LABEL_MAX);
              $("#touchLabel").value = label;
            }
            drawTop();
            drawList();
            return;
          }
          const act = event.target.closest("[data-sheet]")?.dataset.sheet;
          if (act === "done") done();
          else if (act === "remove" && apply((d) => removeButton(d, row.key))) close();
        });

        content.addEventListener("input", (event) => {
          if (event.target.id === "touchLabel") {
            label = event.target.value;
            labelTouched = true;
            drawTop();
          } else if (event.target.matches("[data-pick-search]")) {
            query = event.target.value;
            drawList();
          }
        });

        content.addEventListener("keydown", (event) => {
          if (event.target.id === "touchLabel" && event.key === "Enter") {
            event.preventDefault();
            if (!$('[data-sheet="done"]').disabled) done();
          }
        });

        drawTop();
        drawList();
      },
    });
    sheet = opened;
    opened.content.querySelector(".pick-row.is-current")?.scrollIntoView({ block: "center" });
  }

  /* -- saving ------------------------------------------------------------------ */

  async function save() {
    if (saving || !dirty) return;
    saving = true;
    render();
    try {
      await api.saveActivity(touchSavePayload(hub.state.config, draft));
      dirty = false;
      saved = true;
      await hub.reloadConfig();
      draft = readTouchScreen(hub.state.config, activityId);
      snackbar("Saved. The Touch picks up the change by itself.");
    } catch (error) {
      // The hub can apply a save and still report a failure (a slow engine),
      // so look at what it has now before saying what happened.
      await hub.reloadConfig();
      const outcome = hub.state.configError ? "unknown" : saveOutcome(hub.state.config, draft);
      if (outcome === "saved") {
        dirty = false;
        saved = true;
        draft = readTouchScreen(hub.state.config, activityId);
        snackbar("Saved, though the hub was slow to confirm. The Touch picks up the change by itself.");
      } else if (outcome === "unchanged") {
        snackbar(`Not saved — ${error.message || "hub error"}. Nothing changed on the hub; your changes are still here, so you can try again.`, { error: true });
      } else if (outcome === "changed") {
        dirty = false;
        saved = true;
        draft = readTouchScreen(hub.state.config, activityId);
        snackbar(`The hub didn't confirm the save, and its copy of this screen changed. This shows what the hub has now.`, { error: true });
      } else {
        snackbar(`Couldn't save — ${error.message || "hub error"}. Reload to see what the hub has.`, { error: true });
      }
    } finally {
      saving = false;
      if (!section.hidden) render();
    }
  }

  function undo() {
    draft = readTouchScreen(hub.state.config, activityId);
    dirty = false;
    render();
  }

  async function confirmDiscard() {
    if (saving) {
      snackbar("Saving to the hub… one moment");
      return false;
    }
    if (!dirty) return true;
    const discard = await confirmDialog({
      title: "Discard changes?",
      text: "Nothing has been saved to the hub yet.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (discard) dirty = false;
    return discard;
  }

  async function requestClose() {
    if (await confirmDiscard()) location.hash = "#activities";
  }

  /* -- events ------------------------------------------------------------------- */

  root.addEventListener("click", (event) => {
    if (saving) return;
    const edit = event.target.closest("[data-edit]");
    if (edit) {
      openButtonSheet(edit.dataset.edit);
      return;
    }
    const move = event.target.closest("[data-move]");
    if (move) {
      apply((d) => moveButton(d, move.dataset.move, Number(move.dataset.step)));
      return;
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "add") openButtonSheet(null);
    else if (act === "save") save();
    else if (act === "undo") undo();
    else if (act === "retry") hub.reloadConfig().then(() => view.onShow({ args: [activityId] }));
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty || section.hidden) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const view = {
    async onShow({ args = [] } = {}) {
      const token = (showToken += 1);
      sheet?.close();
      draft = null;
      dirty = false;
      saving = false;
      saved = false;
      blocked = "";
      try {
        activityId = decodeURIComponent(args[0] ?? "");
      } catch (_) {
        activityId = ""; // a malformed escape is just an unknown activity
      }
      root.innerHTML = `<div class="m-center">${spinner("Loading")}</div>`;
      updateBar();
      await hub.ensureConfig();
      if (token !== showToken || section.hidden) return;
      if (hub.state.configError) {
        renderBlocked("error");
        return;
      }
      if (!hub.activityById(activityId)) {
        renderBlocked("missing");
        return;
      }
      draft = readTouchScreen(hub.state.config, activityId);
      render();
      root.querySelector(".wiz-intro h2")?.focus({ preventScroll: true });
    },
    onHide() {
      showToken += 1;
      sheet?.close();
    },
    confirmLeave: confirmDiscard,
  };
  return view;
}
