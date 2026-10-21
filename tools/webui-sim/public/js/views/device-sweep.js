/* Send all commands (#devices/<id>/sweep), the app's IR sweep: every command
   a device has, one after another, to find the codes it really answers to.
   The web keeps its dry run, the choice of commands, the chunk size, the
   progress and the log. A run goes on while the page is closed: the hub
   tracks it by run id, and Stop cancels it there. */

import { postApiForm } from "../api.js";
import * as hub from "../state.js";
import { escapeHtml, sectionLabel, setAppBar, spinner } from "../ui/shell.js";
import { stepperRow } from "./device-sheets.js";
import { LIMITS, chunkCommands, clampDelay, isSafeRunId, makeRunId } from "./ir-model.js";

const LOG_LINES = 40;

const STEPPERS = {
  gap: {
    title: "Gap between commands",
    sub: `${LIMITS.delayMin}–${LIMITS.delayMax} ms; the hub keeps it in that range`,
    step: 20,
    min: LIMITS.delayMin,
    max: LIMITS.delayMax,
    unit: "ms",
    less: "Shorter gap",
    more: "Longer gap",
  },
  chunk: {
    title: "Commands per request",
    sub: `1–${LIMITS.batchCommands}; progress shows after each request`,
    step: 50,
    min: 1,
    max: LIMITS.batchCommands,
    less: "Fewer per request",
    more: "More per request",
  },
};

export function createDeviceSweep({ root }) {
  let deviceId = "";
  let active = false;
  const values = { gap: 120, chunk: 250 };
  const typed = {};
  let excluded = new Set(); // commands left out, by name, for `choiceFor`
  let choiceFor = "";
  const run = {
    deviceId: "",
    deviceName: "",
    runId: "",
    running: false,
    dry: true,
    sent: 0,
    total: 0,
    canceled: false,
    status: null, // { text, kind }
    log: [],
  };
  let note = null; // { deviceId, text }: a run that couldn't start
  let logOpen = false;

  function device() {
    return hub.deviceById(deviceId);
  }

  function chosen(d) {
    return (d?.commands ?? []).filter((c) => !excluded.has(c.name));
  }

  function log(line) {
    run.log.unshift(line);
    if (run.log.length > LOG_LINES) run.log.length = LOG_LINES;
  }

  /* -- markup ------------------------------------------------------------------ */

  function stepper(key) {
    const s = STEPPERS[key];
    return stepperRow({
      key,
      title: s.title,
      sub: s.sub,
      text: key in typed ? typed[key] : String(values[key]),
      value: values[key],
      min: s.min,
      max: s.max,
      unit: s.unit ?? "",
      spoken: s.unit ? " in milliseconds" : "",
      less: s.less,
      more: s.more,
      disabled: run.running,
    });
  }

  function progressMarkup() {
    const p = run.total ? Math.min(1, run.sent / run.total) : 0;
    const label = run.running
      ? `${run.dry ? "Dry run" : "Sending"}: ${run.sent} of ${run.total}${run.canceled ? ", stopping" : ""}`
      : run.total
        ? `${run.dry ? "Dry run" : "Run"} ${run.canceled ? "stopped" : "done"}: ${run.sent} of ${run.total}`
        : "";
    if (!label) return "";
    return `<div class="sw-meter" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${run.sent}"><span style="transform:scaleX(${p})"></span></div>
      <p class="sw-meter-label">${escapeHtml(`${run.deviceName} · ${label}`)}</p>`;
  }

  function actionsMarkup(d, count) {
    if (run.running) {
      return run.deviceId === deviceId
        ? `<button type="button" class="btn btn-outlined btn-block" data-act="stop"${run.canceled ? " disabled" : ""}>${spinner()}Stop sweep</button>`
        : "";
    }
    const none = count ? "" : " disabled";
    return `<div class="sw-actions">
        <button type="button" class="btn btn-outlined" data-act="dry"${none}>Dry run</button>
        <button type="button" class="btn btn-filled" data-act="live"${none}>Send ${count} command${count === 1 ? "" : "s"}</button>
      </div>`;
  }

  /* A redraw (after every request of a run) keeps focus on the same control. */
  function focusKey(el) {
    if (!el || !root.contains(el)) return "";
    const d = el.dataset;
    if (d.focus) return `[data-focus="${d.focus}"]`;
    if (d.act) return `[data-act="${d.act}"]`;
    return d.cmd != null ? `[data-cmd="${d.cmd}"]` : "";
  }

  function render() {
    if (!active) return;
    const refocus = focusKey(document.activeElement);
    paint();
    if (refocus) root.querySelector(refocus)?.focus({ preventScroll: true });
  }

  function paint() {
    const d = device();
    if (!d) {
      setAppBar({ title: "Send all commands", back: "devices" });
      root.innerHTML = `<p class="list-note">This device is no longer on the hub.</p>`;
      return;
    }
    if (choiceFor !== deviceId) {
      choiceFor = deviceId;
      excluded = new Set();
    }
    const picked = chosen(d);
    const busyElsewhere = run.running && run.deviceId !== deviceId;
    const lock = run.running ? " disabled" : "";
    const status = note?.deviceId === deviceId ? note : run.deviceId === deviceId ? run.status : null;
    root.innerHTML = `<div class="page sw">
        <p class="ds-hint sw-intro">Sends every command ${escapeHtml(d.name)} has, one after another. Useful for finding which codes the device actually responds to. A dry run checks the list without sending anything.</p>
        ${busyElsewhere ? `<p class="ds-note">A sweep is running on ${escapeHtml(run.deviceName)}. <a href="#devices/${encodeURIComponent(run.deviceId)}/sweep">Open it</a> to follow or stop it.</p>` : ""}
        <div class="m-list">${stepper("gap")}${stepper("chunk")}</div>
        ${busyElsewhere ? "" : actionsMarkup(d, picked.length)}
        ${run.deviceId === deviceId || !run.deviceId ? progressMarkup() : ""}
        <p class="form-msg" role="status" aria-live="polite"${status ? ` data-kind="${status.kind}"` : ""}>${status ? escapeHtml(status.text) : ""}</p>
        ${run.log.length ? `<details class="m-details sw-log"${run.running || logOpen ? " open" : ""}>
            <summary>Run log</summary>
            <ol>${run.log.map((l) => `<li class="mono">${escapeHtml(l)}</li>`).join("")}</ol>
          </details>` : ""}
        <div class="sw-head">
          ${sectionLabel(`Commands: ${picked.length} of ${d.commands.length}`)}
          <span>
            <button type="button" class="btn btn-text" data-act="all"${lock}>All</button>
            <button type="button" class="btn btn-text" data-act="none"${lock}>None</button>
          </span>
        </div>
        ${d.commands.length
          ? `<div class="m-list sw-commands">${d.commands.map((c, i) => `<label class="m-row sw-command">
              <input type="checkbox" data-cmd="${i}"${excluded.has(c.name) ? "" : " checked"}${lock}>
              <span class="mono">${escapeHtml(c.name)}</span>
            </label>`).join("")}</div>`
          : `<p class="list-note">This device has no commands yet.</p>`}
      </div>`;
  }

  /* -- running ------------------------------------------------------------------- */

  async function start(dry) {
    const d = device();
    if (run.running || !d) return;
    const { chunks, total, dropped } = chunkCommands(chosen(d).map((c) => c.name), values.chunk);
    if (!total) {
      // The last run's progress stays with its own device.
      note = { deviceId: d.id, text: "None of the chosen commands has a name the hub can send.", kind: "error" };
      render();
      return;
    }
    note = null;
    let runId = makeRunId(dry ? "dry" : "live");
    if (!isSafeRunId(runId)) runId = `run_${Date.now().toString(36)}`;
    const delay = clampDelay(values.gap);
    Object.assign(run, { deviceId: d.id, deviceName: d.name, runId, running: true, dry, sent: 0, total, canceled: false });
    run.status = {
      text: `${dry ? "Dry-running" : "Sending"} ${total} command${total === 1 ? "" : "s"} as run ${runId}` +
        ` (${chunks.length} request${chunks.length === 1 ? "" : "s"}, ${delay} ms apart)` +
        `${dropped ? `; ${dropped} with names the hub can't take are left out` : ""}.`,
      kind: "info",
    };
    log(`run ${runId}: ${total} commands, ${chunks.length} chunk(s), ${dry ? "dry" : "live"}, ${delay} ms`);
    render();
    try {
      for (let i = 0; i < chunks.length && !run.canceled; i += 1) {
        const j = await postApiForm("/api/ir-batch-send", {
          deviceId: d.id,
          commands: chunks[i],
          delayMs: String(delay),
          dryRun: dry ? "1" : "0",
          runId,
        });
        run.sent += Number(j.sent) || 0;
        if (j.canceled) run.canceled = true;
        const failed = Number(j.failed) || 0;
        log(
          `${dry ? "dry" : "live"} chunk ${i + 1}/${chunks.length}: sent ${j.sent}` +
          `${failed ? `, failed ${failed}` : ""}${Number(j.skipped) ? `, skipped ${j.skipped}` : ""}` +
          ` in ${j.elapsedMs} ms${j.lastReply ? ` · ${String(j.lastReply).slice(0, 60)}` : ""}` +
          `${j.canceled ? " · canceled" : ""}`,
        );
        render();
      }
      run.status = run.canceled
        ? { text: `Run ${runId} stopped after ${run.sent} command${run.sent === 1 ? "" : "s"}.`, kind: "warn" }
        : {
          text: `${dry ? "Dry run" : "Sweep"} done: ${run.sent} command${run.sent === 1 ? "" : "s"}${dry ? " (nothing was sent)" : ""}.`,
          kind: "ok",
        };
    } catch (error) {
      log(`run ${runId} failed: ${error.message}`);
      run.status = { text: `The sweep failed: ${error.message}`, kind: "error" };
    } finally {
      run.running = false;
      render();
      // A live send repairs protocols and takes backups: read the setup again.
      if (!dry) hub.refreshConfig().catch(() => {});
    }
  }

  async function stop() {
    if (!run.runId || !run.running) return;
    run.canceled = true; // queue no further chunks
    render();
    try {
      await postApiForm("/api/ir-cancel", { runId: run.runId });
      log(`cancel requested for ${run.runId}`);
    } catch (error) {
      log(`cancel failed: ${error.message}`);
    }
    render();
  }

  /* -- events ---------------------------------------------------------------------- */

  function step(key, dir) {
    const s = STEPPERS[key];
    values[key] = Math.min(s.max, Math.max(s.min, (Number(values[key]) || s.min) + dir * s.step));
    delete typed[key];
    render();
  }

  root.addEventListener("click", (event) => {
    if (!active) return;
    const stepBtn = event.target.closest("[data-step]");
    if (stepBtn) {
      step(stepBtn.dataset.step, Number(stepBtn.dataset.dir));
      return;
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    const d = device();
    if (act === "dry" || act === "live") start(act === "dry");
    else if (act === "stop") stop();
    else if (act === "all" && d) {
      excluded = new Set();
      render();
    } else if (act === "none" && d) {
      excluded = new Set(d.commands.map((c) => c.name));
      render();
    }
  });

  root.addEventListener("change", (event) => {
    if (!active) return;
    const t = event.target;
    if (t.dataset.cmd != null) {
      const c = device()?.commands[Number(t.dataset.cmd)];
      if (!c) return;
      if (t.checked) excluded.delete(c.name);
      else excluded.add(c.name);
      // Only the counts change: keep the list (and its scroll) as it is.
      const d = device();
      const count = chosen(d).length;
      const label = root.querySelector(".sw-head .m-section");
      if (label) label.textContent = `Commands: ${count} of ${d.commands.length}`;
      const live = root.querySelector("[data-act='live']");
      if (live) live.textContent = `Send ${count} command${count === 1 ? "" : "s"}`;
      root.querySelectorAll("[data-act='dry'], [data-act='live']").forEach((b) => { b.disabled = !count; });
    } else if (t.dataset.value) {
      const key = t.dataset.value;
      if (!(key in typed)) return;
      const s = STEPPERS[key];
      const n = Number.parseInt(typed[key], 10);
      values[key] = Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : values[key];
      delete typed[key];
      t.value = String(values[key]);
    }
  });

  root.addEventListener("input", (event) => {
    if (!active || !event.target.dataset.value) return;
    typed[event.target.dataset.value] = event.target.value;
    note = null;
  });

  root.addEventListener("keydown", (event) => {
    const key = event.target.dataset?.value;
    if (!active || !key || run.running || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    step(key, event.key === "ArrowUp" ? 1 : -1);
    root.querySelector(`[data-focus="${key}-value"]`)?.focus();
  });

  root.addEventListener("toggle", (event) => {
    if (active && event.target.matches?.(".sw-log")) logOpen = event.target.open;
  }, true);

  return {
    show(id) {
      active = true;
      deviceId = id;
      const d = device();
      setAppBar({ title: "Send all commands", back: d ? `devices/${encodeURIComponent(id)}` : "devices" });
      render();
    },
    hide() {
      active = false;
    },
    // The setup changed (an import, a delete): redraw unless a run owns it.
    refresh() {
      if (active && !run.running) render();
    },
  };
}
