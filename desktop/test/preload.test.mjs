import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("preload exposes version 1 and exactly six fixed catalog invoke channels with plain errors", async () => {
  let bridge;
  const calls = [];
  const ipcRenderer = {
    on() {},
    async invoke(channel, args) {
      calls.push([channel, args]);
      if (args?.model === "FAIL") throw new Error("Error invoking remote method 'catalog:search': Error: Sign in to Logitech first");
      return { signedIn: true };
    },
  };
  vm.runInNewContext(readFileSync(new URL("../src/preload.js", import.meta.url), "utf8"), {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "melodiousDesktop"); bridge = value; } } }),
  });
  assert.equal(bridge.version, 1);
  assert.deepEqual(Object.keys(bridge.catalog), ["status", "signIn", "signOut", "checkModel", "search", "download"]);
  for (const key of Object.keys(bridge.catalog)) await bridge.catalog[key]({ id: 1, manufacturer: "Sony", model: "Fixture" });
  assert.deepEqual(calls.map(([channel]) => channel), ["catalog:status", "catalog:sign-in", "catalog:sign-out", "catalog:check-model", "catalog:search", "catalog:download"]);
  await assert.rejects(bridge.catalog.search({ manufacturer: "Sony", model: "FAIL" }), /^Error: Sign in to Logitech first$/);
});
