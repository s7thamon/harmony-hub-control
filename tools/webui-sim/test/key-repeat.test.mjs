import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEARTBEAT_MS, MAX_REPEAT_MS, newHoldId, startRepeat } from "../public/js/views/key-repeat.js";

/* Fake timers: advance(ms) runs due timeouts and intervals in time order and
   lets promise callbacks settle between them. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      jobs.set(id, { fn, at: now + ms, every: 0 });
      return id;
    },
    setInterval(fn, ms) {
      const id = nextId++;
      jobs.set(id, { fn, at: now + ms, every: ms });
      return id;
    },
    clearInterval(id) {
      jobs.delete(id);
    },
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const [id, job] of jobs) if (job.at <= end && (!next || job.at < next[1].at)) next = [id, job];
        if (!next) break;
        const [id, job] = next;
        now = job.at;
        if (job.every) job.at += job.every;
        else jobs.delete(id);
        job.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function recorder({ fail = {}, pressDelay = false } = {}) {
  const calls = [];
  const ids = new Set();
  let finishPress;
  const send = (status, holdId) => {
    calls.push(status);
    ids.add(holdId);
    if (fail[status]) {
      const error = new Error(`${status} failed`);
      error.status = fail[status];
      return Promise.reject(error);
    }
    if (status === "press" && pressDelay) return new Promise((resolve) => (finishPress = resolve));
    return Promise.resolve({ ok: true });
  };
  return { calls, ids, send, finishPress: () => finishPress?.() };
}

describe("startRepeat", () => {
  it("presses at once, renews the lease at once and every interval, then releases, with one hold id", async () => {
    const timers = fakeTimers();
    const r = recorder();
    const stop = startRepeat(r.send, { timers, holdId: "testHold01" });
    await timers.advance(0);
    assert.deepEqual(r.calls, ["press", "hold"]);
    await timers.advance(HEARTBEAT_MS * 3);
    await stop();
    assert.deepEqual(r.calls, ["press", "hold", "hold", "hold", "hold", "release"]);
    assert.deepEqual([...r.ids], ["testHold01"]);
  });

  it("a quick tap is press then release (with one lease renewal between)", async () => {
    const timers = fakeTimers();
    const r = recorder();
    const stop = startRepeat(r.send, { timers });
    await timers.advance(50);
    await stop();
    assert.deepEqual(r.calls, ["press", "hold", "release"]);
  });

  it("stops renewing as soon as it is stopped, and releases once", async () => {
    const timers = fakeTimers();
    const r = recorder();
    const stop = startRepeat(r.send, { timers });
    await timers.advance(HEARTBEAT_MS);
    stop();
    stop();
    await timers.advance(HEARTBEAT_MS * 10);
    assert.deepEqual(r.calls, ["press", "hold", "hold", "release"]);
  });

  it("sends the release only after the press has answered", async () => {
    const timers = fakeTimers();
    const r = recorder({ pressDelay: true });
    const stop = startRepeat(r.send, { timers });
    await timers.advance(10);
    stop();
    await timers.advance(2000);
    assert.deepEqual(r.calls, ["press"]);
    r.finishPress();
    await timers.advance(0);
    assert.deepEqual(r.calls, ["press", "release"]);
  });

  it("ends at the safety cap and says so", async () => {
    const timers = fakeTimers();
    const r = recorder();
    const ends = [];
    startRepeat(r.send, { timers, onEnd: (e) => ends.push(e) });
    await timers.advance(MAX_REPEAT_MS + 2000);
    assert.deepEqual(ends, [null]);
    assert.equal(r.calls.filter((c) => c === "hold").length, MAX_REPEAT_MS / HEARTBEAT_MS - 1);
    assert.equal(r.calls.at(-1), "release");
  });

  it("reports a failed press once, stops, and doesn't release", async () => {
    const timers = fakeTimers();
    const r = recorder({ fail: { press: 502 } });
    const ends = [];
    startRepeat(r.send, { timers, onEnd: (e) => ends.push(e.message) });
    await timers.advance(HEARTBEAT_MS * 4);
    assert.deepEqual(ends, ["press failed"]);
    assert.ok(!r.calls.includes("release"));
  });

  it("ends after three failed renewals in a row, and still releases", async () => {
    const timers = fakeTimers();
    const r = recorder({ fail: { hold: 502 } });
    const ends = [];
    startRepeat(r.send, { timers, onEnd: (e) => ends.push(e?.message) });
    await timers.advance(HEARTBEAT_MS * 4);
    assert.deepEqual(ends, ["hold failed"]);
    assert.deepEqual(r.calls, ["press", "hold", "hold", "hold", "release"]);
  });

  it("rides out a failed renewal or two", async () => {
    const timers = fakeTimers();
    let n = 0;
    const calls = [];
    const send = (status) => {
      calls.push(status);
      if (status === "hold" && (n++ === 1 || n === 4)) return Promise.reject(new Error("blip"));
      return Promise.resolve();
    };
    const ends = [];
    const stop = startRepeat(send, { timers, onEnd: (e) => ends.push(e) });
    await timers.advance(HEARTBEAT_MS * 8);
    await stop();
    assert.deepEqual(ends, []);
    assert.equal(calls.at(-1), "release");
  });

  it("passes on why the hub ended a hold (410)", async () => {
    const timers = fakeTimers();
    const r = recorder({ fail: { hold: 410 } });
    const ends = [];
    startRepeat(r.send, { timers, onEnd: (e, reason) => ends.push([e.message, reason]) });
    await timers.advance(HEARTBEAT_MS * 2);
    assert.deepEqual(ends, [["hold failed", "ended"]]);
  });

  it("ends quietly when a newer press took over first (press 410), sending no release", async () => {
    const timers = fakeTimers();
    const r = recorder({ fail: { press: 410 } });
    const reasons = [];
    startRepeat(r.send, { timers, onEnd: (_e, reason) => reasons.push(reason) });
    await timers.advance(HEARTBEAT_MS * 2);
    assert.deepEqual(reasons, ["superseded"]);
    assert.deepEqual(r.calls, ["press"]);
  });

  it("never has more than three renewals in flight", async () => {
    const timers = fakeTimers();
    const calls = [];
    const send = (status) => {
      calls.push(status);
      return status === "hold" ? new Promise(() => {}) : Promise.resolve();
    };
    const stop = startRepeat(send, { timers });
    await timers.advance(HEARTBEAT_MS * 10);
    await stop();
    assert.deepEqual(calls, ["press", "hold", "hold", "hold", "release"]);
  });

  it("sends no lease renewal before the press has answered", async () => {
    const timers = fakeTimers();
    const r = recorder({ pressDelay: true });
    startRepeat(r.send, { timers });
    await timers.advance(HEARTBEAT_MS * 5);
    assert.deepEqual(r.calls, ["press"]);
    r.finishPress();
    await timers.advance(0);
    assert.deepEqual(r.calls, ["press", "hold"]);
  });

  it("reports a failed press even after a quick tap's release", async () => {
    const timers = fakeTimers();
    const r = recorder({ fail: { press: 502 } });
    const ends = [];
    const stop = startRepeat(r.send, { timers, onEnd: (e, reason) => ends.push([e.message, reason]) });
    stop();
    await timers.advance(10);
    assert.deepEqual(ends, [["press failed", "failed"]]);
    assert.deepEqual(r.calls, ["press"]);
  });

  it("names why a hold ended by itself", async () => {
    for (const [fail, want] of [[{}, "cap"], [{ hold: 410 }, "ended"], [{ hold: 502 }, "failed"], [{ press: 410 }, "superseded"]]) {
      const timers = fakeTimers();
      const r = recorder({ fail });
      const reasons = [];
      startRepeat(r.send, { timers, onEnd: (_e, reason) => reasons.push(reason) });
      await timers.advance(MAX_REPEAT_MS + 1000);
      assert.deepEqual(reasons, [want]);
    }
  });

  it("makes hold ids the hub accepts", () => {
    const a = newHoldId();
    assert.match(a, /^[0-9a-z]{8,40}$/);
    assert.notEqual(a, newHoldId());
  });
});
