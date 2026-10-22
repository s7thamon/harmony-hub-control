// Opt-in local integration test. Hard-pinned to the hub-emu container and
// loopback API; never accepts a real hub address or sends IR.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { catalogRows } from "../../tools/webui-sim/public/js/logitech-catalog.js";

const require = createRequire(import.meta.url);
const { createSchemeHandler } = require("../src/scheme.js");
assert.equal(execFileSync("docker", ["inspect", "hub-emu", "--format", "{{.Config.Image}}"], { encoding: "utf8" }).trim(), "hub-emu");
// Only names/IDs are needed by the import gate. These do NOT validate
// protocol playback or the stock engine: those remain owner-run checks.
execFileSync("docker", ["exec", "hub-emu", "python3", "-c", `
import json
p='/data/resources/ProtocolList.json'
v=json.load(open(p))
for n,i in [('Sony 15 Bit',17),('Sony 20 Bit',18)]:
    if not any(x.get('Name')==n for x in v['Protocols']):
        v['Protocols'].append({'Id-':i,'Name':n})
open(p,'w').write(json.dumps(v,separators=(',',':')))
`]);
const handler = createSchemeHandler({
  shellDir: fileURLToPath(new URL("../build/shell/", import.meta.url)),
  getHub: () => ({ host: "127.0.0.1", port: 8788 }),
});
const request = async (path, body) => {
  const response = await handler.handle(new Request(`melodious://app${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: JSON.parse(await response.text()) };
};
const lab = await request("/api/ir-lab-target", {});
assert.equal(lab.body.ok, true, JSON.stringify(lab));
const wire = JSON.parse(readFileSync(new URL("fixtures/catalog-fixtures.json", import.meta.url)));
const commands = wire.getGlobalLanguageCommands.GetGlobalLanguageCommandsResult;
const plan = catalogRows({ resources: { global_language_commands: commands } }, ["Sony 15 Bit", "Sony 20 Bit"]);
assert.equal(plan.rows.length, 4);
const imported = await request("/api/catalog-import", { deviceId: lab.body.deviceId, commands: plan.rows });
assert.equal(imported.status, 200, JSON.stringify(imported));
assert.match(imported.body.message, /Imported: 4/);
const stored = (await request("/export/devices")).body.DevicesWithFeatures.find((e) => String(e.Device["Id-"]) === String(lab.body.deviceId)).Commands;
for (const expected of commands.slice(0, 4)) {
  const actual = stored.find((c) => c.Name === expected.Name);
  assert.equal(actual.KeyCode, expected.KeyCode);
  assert.equal(actual.ProtocolId, expected.ProtocolId);
}
const refused = await request("/api/catalog-import", { deviceId: lab.body.deviceId, commands: [{ name: "UnsupportedFixture", keycode: commands[4].KeyCode, raw: "" }] });
assert.equal(refused.status, 400);
assert.match(refused.body.message, /Rejected: 1/);
console.log("hub-emu: desktop scheme → Content-Length JSON POST → real MIPS codex_webui: imported 4; KeyCodes byte-identical; ProtocolId 17/18; missing protocol refused: OK");
