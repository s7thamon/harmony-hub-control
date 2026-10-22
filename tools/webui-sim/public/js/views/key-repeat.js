/* Hold-to-repeat for remote keys, the way the app and a Harmony remote do it.
   The hub runs the hold (codex_webui.c hold_run): "press" starts it and sends
   the command, the hub repeats it while the key is held (heartbeats to the
   engine from 380 ms) and "release" ends it. The browser only keeps the
   hold's lease alive with a "hold" request every 200 ms; if those stop
   (closed tab, lost Wi-Fi), the hub releases by itself within 700 ms.

   Pure logic: `send(status, holdId)` does the network call and `timers` can
   be replaced in tests. */

/** The keys that repeat, as in the app (RemoteKeys.kt REPEATABLE_KEYS). */
export const REPEATABLE_KEYS = new Set([
  "VolumeUp", "VolumeDown", "ChannelUp", "ChannelDown",
  "DirectionUp", "DirectionDown", "DirectionLeft", "DirectionRight",
]);
/** Lease heartbeat interval; the hub gives up 700 ms after the last one. */
export const HEARTBEAT_MS = 200;
/** Backstop cap. The hub ends every hold after 30 s and says so (410); this
    only matters if the hub can't be reached. */
export const MAX_REPEAT_MS = 31000;
/** Lease heartbeats allowed in flight at once. */
const MAX_IN_FLIGHT = 3;
/** Failed heartbeats in a row that end a hold (the lease outlasts two). */
const MAX_FAILED_BEATS = 3;

/** A fresh id for one hold (the hub accepts 8–40 letters and digits). */
export function newHoldId() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/**
 * Start a hold. Returns stop(), which is safe to call more than once and
 * resolves once the release has been sent (after the press has answered,
 * so the hub always sees them in order). Lease heartbeats start once the
 * press has answered, so none reaches the hub before the hold exists.
 * `onEnd(error, reason)` is called once if the hold fails or ends by
 * itself, even after stop(): reason "failed" (the press, or three
 * heartbeats in a row, failed; error says why), "ended" (the hub ended it, 410; error.message
 * says why), "superseded" (a newer key press took over before this one went
 * out; nothing was sent) or "cap" (MAX_REPEAT_MS, hub unreachable).
 */
export function startRepeat(send, { onEnd, timers = globalThis, holdId = newHoldId() } = {}) {
  let stopped = false;
  let ended = false;
  let pressFailed = false;
  let inFlight = 0;
  let ticks = 0;
  let failedBeats = 0;
  let interval = null;
  let stopping = null;

  const end = (error, reason) => {
    if (ended) return;
    ended = true;
    onEnd?.(error, reason);
    stop();
  };

  const beat = () => {
    if (stopped) return;
    ticks += 1;
    if (ticks * HEARTBEAT_MS >= MAX_REPEAT_MS) {
      end(null, "cap");
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) return;
    inFlight += 1;
    Promise.resolve()
      .then(() => send("hold", holdId))
      .then(() => {
        failedBeats = 0;
      })
      .catch((error) => {
        if (stopped) return;
        if (error?.status === 410) end(error, "ended");
        // A blip is fine: the hub's lease outlasts a couple of lost beats.
        else if (++failedBeats >= MAX_FAILED_BEATS) end(error, "failed");
      })
      .finally(() => {
        inFlight -= 1;
      });
  };

  const pressed = Promise.resolve()
    .then(() => send("press", holdId))
    .then(
      () => {
        if (stopped) return;
        // Renew at once: the hub starts the lease clock when it answers.
        beat();
        interval = timers.setInterval(beat, HEARTBEAT_MS);
      },
      (error) => {
        pressFailed = true;
        end(error, error?.status === 410 ? "superseded" : "failed");
      },
    );

  function stop() {
    if (stopping) return stopping;
    stopped = true;
    stopping = pressed
      .then(() => {
        if (interval !== null) timers.clearInterval(interval);
        return pressFailed ? undefined : send("release", holdId);
      })
      .catch(() => {});
    return stopping;
  }

  return stop;
}
