import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalogRows, hubProtocolNames, describeCatalogRows } from "../public/js/logitech-catalog.js";

const PKG = {
  schema_version: "0.2.0",
  resources: {
    global_language_commands: [
      { Name: "PowerOn", KeyCode: "G:Sony 15 Bit:()(0x3A0C)():3", ProtocolId: 17 },
      { Name: "PowerOff", KeyCode: "G:Sony 15 Bit:()(0x7A0C)():3", ProtocolId: 17 },
      { Name: "VolumeUp", KeyCode: "G:Sony 15 Bit:()(0x240C)():3", ProtocolId: 17 },
      { Name: "SmartKey", KeyCode: "G:RC6 Mode 0:()(0x1)():0", ProtocolId: 999 },
      { Name: "LearnedRaw", KeyCode: "", Raw: "F38000P500S500" },
      { Name: "Broken", KeyCode: "", Raw: "" },
      { Name: "", KeyCode: "G:Sony 15 Bit:()(0x1)():3", ProtocolId: 17 },
    ],
  },
};

describe("catalogRows", () => {
  it("imports only KeyCodes whose protocol is on the hub", () => {
    const result = catalogRows(PKG, ["Sony 15 Bit", "Toshiba 32 Bit"]);
    assert.deepEqual(result.rows.map((r) => r.name), ["PowerOn", "PowerOff", "VolumeUp", "LearnedRaw"]);
    assert.deepEqual(result.protocolsUsed, ["Sony 15 Bit"]);
    assert.deepEqual(result.missingProtocols, ["RC6 Mode 0"]);
    assert.equal(result.skipped.length, 3);
    assert.match(result.skipped[0].reason, /RC6 Mode 0/);
  });

  it("refuses every KeyCode when no protocol list is known", () => {
    const result = catalogRows(PKG, []);
    assert.deepEqual(result.rows.map((r) => r.name), ["LearnedRaw"]);
    assert.deepEqual(result.missingProtocols.sort(), ["RC6 Mode 0", "Sony 15 Bit"]);
  });

  it("handles a package without commands", () => {
    const result = catalogRows({ resources: {} }, ["Sony 15 Bit"]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.skipped.length, 0);
  });

  it("summarises importable, skipped and missing protocols", () => {
    const text = describeCatalogRows(catalogRows(PKG, ["Sony 15 Bit"]));
    assert.match(text, /4 importable/);
    assert.match(text, /Sony 15 Bit/);
    assert.match(text, /missing on hub: RC6 Mode 0/);
  });
});

describe("hubProtocolNames", () => {
  it("reads names out of a ProtocolList export", () => {
    assert.deepEqual(
      hubProtocolNames({ Protocols: [{ Name: "Sony 15 Bit" }, { Name: "Toshiba 32 Bit" }, {}] }),
      ["Sony 15 Bit", "Toshiba 32 Bit"],
    );
    assert.deepEqual(hubProtocolNames(null), []);
  });
});
