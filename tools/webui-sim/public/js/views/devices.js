/* Devices tab (#devices, #devices/<id>): the app's DevicesScreen.
   The list searches devices and their commands; a device opens its own page
   with the same keypad as the activity remote (sending straight to that
   device, outside any activity) and every command it has. Learning,
   importing and the device's settings live in IR setup (#ir) until the
   Devices slice moves them here. */

import * as hub from "../state.js";
import {
  escapeHtml,
  icon,
  iconTile,
  listRow,
  openSheet,
  screenTitle,
  setAppBar,
  snackbar,
  spinner,
} from "../ui/shell.js";
import { resolveSkinPowerAction } from "./control-power.js";
import { deviceIconName, deviceKeys } from "./remote-model.js";
import {
  describe,
  flash,
  moreKeysMarkup,
  padMarkup,
  sendCommand,
  wireKeys,
  wireMoreKeys,
} from "./remote-pad.js";

export function createDevicesView(section) {
  let deviceId = "";
  let query = "";
  let tab = "remote";
  let commandQuery = "";
  let device = null;
  let keys = new Map();
  let sheet = null;
  let shown = "";

  section.innerHTML = `<div class="devices-root" id="devicesRoot"></div>`;
  const root = section.querySelector("#devicesRoot");

  /* -- list ------------------------------------------------------------------- */

  function matches() {
    const q = query.trim().toLowerCase();
    return hub.devices()
      .map((d) => {
        const nameHit = !q || [d.name, d.model, d.manufacturer].some((v) => v.toLowerCase().includes(q));
        const commandHits = q ? d.commands.filter((c) => c.name.toLowerCase().includes(q)).length : 0;
        return nameHit || commandHits ? { d, commandHits } : null;
      })
      .filter(Boolean);
  }

  function rowsMarkup() {
    const rows = matches();
    if (!rows.length) {
      return `<p class="list-note">${query.trim() ? `Nothing matches “${escapeHtml(query.trim())}”.` : "No devices on this hub yet."}</p>`;
    }
    return `<div class="m-list">${rows
      .map(({ d, commandHits }) => {
        const subtitle = commandHits
          ? `${commandHits} matching command${commandHits === 1 ? "" : "s"}`
          : [d.model || d.manufacturer, `${d.commands.length} command${d.commands.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
        const badge = `<span class="badge${d.isBluetooth ? " badge-bluetooth" : ""}">${d.isBluetooth ? "Bluetooth" : "IR"}</span>`;
        return listRow({
          title: d.name,
          subtitle,
          leading: iconTile(deviceIconName(d)),
          trailing: badge,
          href: `#devices/${encodeURIComponent(d.id)}`,
          attrs: `aria-label="Open ${escapeHtml(d.name)}"`,
        });
      })
      .join("")}</div>`;
  }

  function renderList() {
    const s = hub.state;
    if (!s.configLoaded) {
      root.innerHTML = `<div class="m-center">${spinner("Loading devices")}</div>`;
      return;
    }
    if (s.configError) {
      root.innerHTML = `${screenTitle("Devices")}<p class="list-note">Couldn't load the hub's devices: ${escapeHtml(s.configError.message)}</p>
        <button type="button" class="btn btn-filled" data-act="retry">Try again</button>`;
      return;
    }
    root.innerHTML = `<div class="page">
        ${screenTitle("Devices")}
        <label class="search-field">${icon("search", { size: 22 })}<input type="search" id="deviceSearch" value="${escapeHtml(query)}" placeholder="Search devices or commands" aria-label="Search devices or commands"></label>
        <div id="deviceRows">${rowsMarkup()}</div>
        <p class="list-note">Open a device to control it directly, outside any activity.</p>
        <div class="m-list">${listRow({
          title: "IR setup",
          subtitle: "Add devices, learn buttons, import codes, test commands",
          leading: iconTile("settings_remote"),
          chevron: true,
          href: "#ir",
        })}</div>
      </div>`;
  }

  /* -- device page -------------------------------------------------------------- */

  function setStatus(text, kind) {
    const el = root.querySelector("#deviceStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind ?? "";
  }

  function sendAction(action, label, el) {
    flash(el);
    return sendCommand(action, { label, status: setStatus });
  }

  function pressKey(entry, which, el) {
    sendAction(which === "hold" ? entry.hold : entry.press, entry.label, el);
  }

  function panelSource() {
    return device && { keys, softButtons: [], devices: [device], title: device.name };
  }

  function commandRows() {
    const q = commandQuery.trim().toLowerCase();
    const list = device.commands
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !q || c.name.toLowerCase().includes(q));
    if (!list.length) return `<p class="list-note">Nothing matches “${escapeHtml(commandQuery.trim())}”.</p>`;
    return `<div class="cmd-list">${list
      .map(({ c, i }) => `<button type="button" class="cmd-row" data-cmd-device="${escapeHtml(device.id)}" data-cmd="${i}">${escapeHtml(c.name)}</button>`)
      .join("")}</div>`;
  }

  function renderDevice() {
    const s = hub.state;
    if (!s.configLoaded) {
      root.innerHTML = `<div class="m-center">${spinner("Loading the device")}</div>`;
      return;
    }
    device = hub.deviceById(deviceId);
    if (!device) {
      setAppBar({ title: "Device", back: "devices" });
      root.innerHTML = `<p class="list-note">This device is no longer on the hub.</p>`;
      return;
    }
    keys = deviceKeys(device);
    const power = powerAction();
    const powerLabel = power.kind === "device-power" ? `Send ${power.command} to ${device.name}` : `${device.name} has no power command`;
    setAppBar({
      title: device.name,
      back: "devices",
      actions: `<a class="icon-btn" href="#ir" aria-label="IR setup for ${escapeHtml(device.name)}" title="IR setup">${icon("tune_outlined")}</a>
        <button type="button" class="icon-btn icon-btn-power" data-act="device-power" aria-label="${escapeHtml(powerLabel)}" title="${escapeHtml(powerLabel)}"${power.kind === "device-power" ? "" : " disabled"}>${icon("power_settings_new")}</button>`,
    });
    const tabs = `<div class="seg-tabs" role="tablist" aria-label="${escapeHtml(device.name)}">
        <button type="button" role="tab" class="seg-tab" data-tab="remote" aria-selected="${tab === "remote"}">Remote</button>
        <button type="button" role="tab" class="seg-tab" data-tab="commands" aria-selected="${tab === "commands"}">Commands (${device.commands.length})</button>
      </div>`;
    const body = tab === "remote"
      ? `<div class="remote">
          <div class="remote-main">
            <p class="remote-status" id="deviceStatus" role="status" aria-live="polite"></p>
            ${tabs}
            <div class="remote-surface">${padMarkup(keys)}</div>
          </div>
          <aside class="remote-side" aria-label="More keys">${moreKeysMarkup(keys, { title: device.name })}</aside>
        </div>`
      : `<div class="page">
          <p class="remote-status" id="deviceStatus" role="status" aria-live="polite"></p>
          ${tabs}
          <div class="cmd-tools">
            <a class="btn btn-outlined" href="#ir">${icon("settings_remote_outlined", { size: 18 })}Learn a button</a>
            <a class="btn btn-outlined" href="#ir">${icon("content_paste_outlined", { size: 18 })}Import codes</a>
          </div>
          <label class="search-field">${icon("search", { size: 22 })}<input type="search" id="commandSearch" value="${escapeHtml(commandQuery)}" placeholder="Search ${device.commands.length} commands" aria-label="Search ${device.commands.length} commands"></label>
          <p class="list-note">Tap a command to send it.</p>
          <div id="commandRows">${commandRows()}</div>
        </div>`;
    root.innerHTML = body;
    const side = root.querySelector(".remote-side");
    if (side) wireMoreKeys(side, { source: panelSource, send: sendAction, keyEvents: false });
  }

  function render() {
    const key = JSON.stringify([deviceId, tab, hub.state.configLoaded, Boolean(hub.state.configError)]);
    const configChanged = root.dataset.config !== String(hub.state.config?.revision ?? "");
    if (key === shown && !configChanged) return;
    shown = key;
    root.dataset.config = String(hub.state.config?.revision ?? "");
    if (deviceId) renderDevice();
    else {
      setAppBar(null);
      renderList();
    }
  }

  function openMoreKeys() {
    sheet?.close();
    const opened = openSheet({
      label: "More keys",
      // close fires asynchronously: only forget this sheet, not a newer one.
      onClose: () => { if (sheet === opened) sheet = null; },
      render: (content) => {
        content.innerHTML = moreKeysMarkup(keys, { title: device.name });
        wireMoreKeys(content, { source: panelSource, send: sendAction, onPress: pressKey });
      },
    });
    sheet = opened;
  }

  /* The device's first power command by name (PowerOff, standby, a toggle),
     the same key the hub's own remote page and the app use. */
  function powerAction() {
    return resolveSkinPowerAction({
      mode: "devices",
      currentActivityId: hub.state.currentId,
      selectedDeviceId: device.id,
      deviceCommands: device.commands,
    });
  }

  function powerDevice() {
    if (!device) return;
    const action = powerAction();
    if (action.kind !== "device-power") {
      snackbar(`${device.name} has no power command`, { error: true });
      return;
    }
    sendAction({ deviceId: action.deviceId, command: action.command, functionId: action.functionId }, "Power");
  }

  /* -- events ------------------------------------------------------------------- */

  wireKeys(root, {
    keyFor: (k) => keys.get(k) ?? null,
    onPress: pressKey,
    onPreview: (entry) => {
      if (entry) setStatus(describe(entry.label, entry.press), "preview");
    },
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest(".remote-side")) return;
    const tabBtn = event.target.closest("[data-tab]");
    if (tabBtn && tabBtn.dataset.tab !== tab) {
      tab = tabBtn.dataset.tab;
      render();
      root.querySelector(`[data-tab="${tab}"]`)?.focus();
      return;
    }
    const cmd = event.target.closest("[data-cmd]");
    if (cmd && device) {
      const c = device.commands[Number(cmd.dataset.cmd)];
      if (c) sendAction({ deviceId: device.id, command: c.name, functionId: c.functionId }, c.name, cmd);
      return;
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "more") openMoreKeys();
    else if (act === "retry") hub.reloadConfig();
  });

  root.addEventListener("input", (event) => {
    if (event.target.id === "deviceSearch") {
      query = event.target.value;
      root.querySelector("#deviceRows").innerHTML = rowsMarkup();
    } else if (event.target.id === "commandSearch") {
      commandQuery = event.target.value;
      root.querySelector("#commandRows").innerHTML = commandRows();
    }
  });

  document.getElementById("appbar")?.addEventListener("click", (event) => {
    if (section.hidden || !deviceId) return;
    if (event.target.closest("[data-act='device-power']")) powerDevice();
  });

  hub.subscribe(() => {
    if (!section.hidden) render();
  });

  return {
    onShow({ args = [] } = {}) {
      let next = args[0] ?? "";
      try {
        next = decodeURIComponent(next);
      } catch (_) {
        // A malformed escape is just an unknown device.
      }
      if (next !== deviceId) {
        tab = "remote";
        commandQuery = "";
      }
      deviceId = next;
      shown = "";
      hub.ensureConfig();
      render();
    },
    onHide() {
      sheet?.close();
      shown = "";
    },
  };
}
