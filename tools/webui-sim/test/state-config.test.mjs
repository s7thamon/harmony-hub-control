import { describe, it } from "node:test";
import assert from "node:assert/strict";

/* Config reads after a change: refreshConfig keeps the config on screen,
   only the newest read changes the state, and a reload never reuses a read
   that was already on its way. fetch is stubbed; each GET waits for the test
   to answer it. */

const pending = [];
globalThis.fetch = (path) => new Promise((resolve, reject) => {
  pending.push({
    path,
    answer: (body) => resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) }),
    fail: () => reject(new TypeError("network down")),
  });
});

const hub = await import("../public/js/state.js");

const config = (revision) => ({ ok: true, revision, deviceList: { DevicesWithFeatures: [] } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function next() {
  for (let i = 0; i < 20 && !pending.length; i += 1) await flush();
  const request = pending.shift();
  assert.ok(request, "expected a config GET");
  assert.equal(request.path, "/api/activity-config");
  return request;
}

describe("config reads", () => {
  it("a refresh that fails keeps the config on screen", async () => {
    const loading = hub.ensureConfig();
    (await next()).answer(config("a"));
    await loading;
    assert.equal(hub.state.config.revision, "a");

    const refresh = hub.refreshConfig();
    (await next()).fail();
    await assert.rejects(refresh);
    assert.equal(hub.state.config.revision, "a");
    assert.equal(hub.state.configError, null);
    assert.equal(hub.state.configLoaded, true);
  });

  it("an older answer never replaces a newer one, and its caller gets the newer setup", async () => {
    const first = hub.refreshConfig();
    const slow = await next();
    const second = hub.refreshConfig();
    (await next()).answer(config("c"));
    await second;
    slow.answer(config("b"));
    // The first read started before the second, so the second's answer has
    // everything the first would have shown: a change checked against it counts.
    assert.equal((await first).config.revision, "c");
    assert.equal(hub.state.config.revision, "c");
  });

  it("a refresh overtaken by a reload waits for the reload's answer", async () => {
    const refresh = hub.refreshConfig();
    const old = await next();
    const reload = hub.reloadConfig();
    const fresh = await next();
    old.answer(config("before-reload"));
    await flush();
    assert.equal(hub.state.config, null, "the reload's blank page stays until its own answer");
    fresh.answer(config("reloaded"));
    assert.equal((await refresh).config.revision, "reloaded");
    await reload;
  });

  it("a reload loads afresh even while an older read is on its way", async () => {
    const reload = hub.reloadConfig();
    const stale = await next();
    // A change lands meanwhile and is read back...
    const refresh = hub.refreshConfig();
    (await next()).answer(config("after-change"));
    await refresh;
    // ...then Try again blanks the page and asks once more.
    const retry = hub.reloadConfig();
    assert.equal(hub.state.configLoaded, false);
    const fresh = await next();
    stale.answer(config("before-change"));
    await flush();
    assert.equal(hub.state.configLoaded, false, "the stale answer does not count as loaded");
    fresh.answer(config("fresh"));
    await retry;
    // The first caller waited for the newest read instead of the stale one.
    const seen = await reload;
    assert.equal(seen.config.revision, "fresh");
    assert.equal(hub.state.config.revision, "fresh");
    assert.equal(hub.state.configLoaded, true);
  });

  it("with nothing on screen, a failed refresh shows the error until a read answers", async () => {
    const reload = hub.reloadConfig();
    const blank = await next();
    const refresh = hub.refreshConfig();
    (await next()).fail();
    await assert.rejects(refresh);
    assert.equal(hub.state.configLoaded, true);
    assert.ok(hub.state.configError);
    blank.answer(config("late"));
    await reload;
    assert.equal(hub.state.config.revision, "late", "a setup beats an error");
    assert.equal(hub.state.configError, null);
  });
});
