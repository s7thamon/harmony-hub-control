import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkShippedCopyHygiene, deriveForbiddenTokens } from "../../shipped_copy_hygiene.mjs";

describe("shipped_copy_hygiene", () => {
  it("derives fixture ids and personal names, not command words", () => {
    const tokens = deriveForbiddenTokens();
    assert.ok(tokens.ids.includes("66690268"));
    assert.ok(tokens.names.includes("Heather's PC"));
    assert.ok(tokens.names.includes("OLED65C8PUA"));
    assert.equal(tokens.names.includes("Play"), false);
    assert.ok(tokens.allowlist.some((a) => a.phrase === "SHIELD"));
  });

  it("passes on the current tree", () => {
    const result = checkShippedCopyHygiene();
    assert.equal(result.ok, true, result.problems.map((p) => `${p.file}:${p.token}`).join("; "));
  });
});
