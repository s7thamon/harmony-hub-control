import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* codex_webui is built with Zig 0.16's libc for MIPS, whose pipe() returns
   the first descriptor instead of 0 on success. A `pipe(...) != 0` check
   therefore fails on the hub (it broke every hold in PR #30) while passing
   every test on a Mac. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("libc quirks on the hub", () => {
  it("never treats a successful pipe() as a failure", () => {
    for (const name of ["codex_webui.c", "codex_hal_ltcp.c", "codex_portal.c", "codex_dhcpd.c", "codex_bthid_keyboard.c", "codex_bt_pair_agent.c"]) {
      let source;
      try {
        source = readFileSync(join(ROOT, "payload/source", name), "utf8");
      } catch {
        continue;
      }
      const zeroChecks = source.match(/\bpipe2?\s*\([^)]*\)\s*(?:!=|==)\s*0\b/g) ?? [];
      assert.deepEqual(zeroChecks, [], `${name}: check pipe() with < 0, not against 0`);
    }
  });
});
