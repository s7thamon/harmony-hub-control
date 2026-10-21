/* The IR lab (#devices/lab): a scratch device for trying codes. Set it up,
   import, learn or sweep codes on it like on any device, then clear it,
   without touching your real devices. The hub knows the lab device by its
   fixed name, so this page does too. */

import { postApiForm } from "../api.js";
import * as hub from "../state.js";
import { dangerGuard } from "../setup-kit.js";
import { iconTile, listRow, sectionLabel, setAppBar, snackbar, spinner } from "../ui/shell.js";
import { setMessage } from "./device-sheets.js";

const LAB_DEVICE_NAME = "Temporary IR Test"; // ensure_lab_target_device()

export function labDevice() {
  return hub.devices().find((d) => d.name === LAB_DEVICE_NAME) ?? null;
}

export function createIrLab({ root }) {
  let active = false;
  let busy = "";
  let labGuard;

  function status() {
    return root.querySelector("[data-lab-status]");
  }

  function render() {
    if (!active) return;
    labGuard?.disarm();
    labGuard = null;
    const lab = labDevice();
    const count = lab?.commands.length ?? 0;
    root.innerHTML = `<div class="page lab">
        <p class="ds-hint">Stage throw-away commands on a scratch device, send them, then clear it, without touching your real devices. Open the lab device to import or learn codes and to send them all.</p>
        ${sectionLabel("Lab device")}
        <div class="m-list">${lab
          ? listRow({
            title: lab.name,
            subtitle: `${count} command${count === 1 ? "" : "s"}`,
            leading: iconTile("build_outlined"),
            chevron: true,
            href: `#devices/${encodeURIComponent(lab.id)}`,
            attrs: `aria-label="Open the lab device, ${count} command${count === 1 ? "" : "s"}"`,
          })
          : listRow({ title: "Not set up yet", subtitle: "The hub adds it as a device of its own", leading: iconTile("build_outlined") })}</div>
        <div class="lab-actions">
          ${lab ? "" : `<button type="button" class="btn btn-filled" data-act="lab-target"${busy ? " disabled" : ""}>${busy === "target" ? spinner() : ""}Set up the lab device</button>`}
          ${lab ? `<button type="button" class="btn btn-danger" id="labClear"${busy || !count ? " disabled" : ""}>Clear the lab device</button>` : ""}
        </div>
        <p class="form-msg" data-lab-status role="status" aria-live="polite"></p>
      </div>`;
    const labClearBtn = root.querySelector("#labClear");
    if (labClearBtn) {
      labGuard = dangerGuard(labClearBtn, {
        consequence: "Deletes every command on the temporary IR lab device.",
        confirmLabel: "Clear lab",
        onConfirm: doLabClear,
      });
    }
  }

  async function doLabTarget() {
    busy = "target";
    render();
    setMessage(status(), "Preparing the temporary test device…");
    try {
      const j = await postApiForm("/api/ir-lab-target", {});
      await hub.refreshConfig().catch(() => {});
      snackbar(j.message || "The lab device is ready.");
    } catch (error) {
      busy = "";
      render();
      setMessage(status(), error.message || "Couldn't set up the lab device.", "error");
      return;
    }
    busy = "";
    render();
  }

  async function doLabClear() {
    const lab = labDevice();
    if (!lab) return;
    busy = "clear";
    setMessage(status(), "Clearing the lab device…");
    try {
      const j = await postApiForm("/api/ir-lab-clear", { deviceId: lab.id });
      await hub.refreshConfig().catch(() => {});
      snackbar(j.message || "The lab device is clear.");
    } catch (error) {
      busy = "";
      render();
      setMessage(status(), error.message || "Clearing failed.", "error");
      return;
    }
    busy = "";
    render();
  }

  root.addEventListener("click", (event) => {
    if (!active || busy) return;
    if (event.target.closest("[data-act='lab-target']")) doLabTarget();
  });

  return {
    show() {
      active = true;
      setAppBar({ title: "IR lab", back: "devices" });
      render();
    },
    hide() {
      active = false;
      labGuard?.disarm();
    },
    refresh() {
      // Not while the clear guard is armed: a redraw would disarm it.
      if (active && !busy && !root.querySelector(".danger-guard-armed")) render();
    },
  };
}

/** The note on the lab device's own page. */
export function labNote(device) {
  return device?.name === LAB_DEVICE_NAME
    ? `<p class="list-note">This is the IR lab's scratch device. <a href="#devices/lab">Clear it in the IR lab</a> when you're done.</p>`
    : "";
}

