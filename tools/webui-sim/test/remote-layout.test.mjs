import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REMOTE_BUTTONS, matchCommand } from "../public/js/remote-layout.js";

const aliasesOf = (label) => REMOTE_BUTTONS.find((b) => b.label === label).aliases;
const commands = (...names) => names.map((name) => ({ name }));

describe("matchCommand", () => {
  it("prefers a command named exactly like an alias over an earlier partial match", () => {
    // "enter" is inside "CenterDown", which sorts first.
    assert.equal(matchCommand(commands("CenterDown", "Enter"), aliasesOf("OK")).name, "Enter");
    // "previous" is inside "PreviousTrack", which sorts before "Return".
    assert.equal(matchCommand(commands("PreviousTrack", "Return"), aliasesOf("Back")).name, "Return");
  });

  it("still finds a partial match when no name is exact", () => {
    assert.equal(matchCommand(commands("Input", "VolumeUpFast"), aliasesOf("Volume up")).name, "VolumeUpFast");
  });

  it("keeps device order among exact matches", () => {
    assert.equal(matchCommand(commands("Enter", "Select"), aliasesOf("OK")).name, "Enter");
  });

  it("returns null when nothing matches", () => {
    assert.equal(matchCommand(commands("PowerOn"), aliasesOf("Back")), null);
    assert.equal(matchCommand(undefined, aliasesOf("Back")), null);
  });
});
