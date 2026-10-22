import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeIr } from "../public/js/ir-encode.js";
import { parseLibraryText } from "../public/js/ir-library.js";
import { prontoToHarmonyRaw } from "../public/js/views/ir-model.js";

const { vectors } = JSON.parse(readFileSync(new URL("./ir-encode.vectors.json", import.meta.url), "utf8"));

/* A Raw code as signed µs (+mark, −space) and its carrier. */
function decodeRaw(code) {
  const [, freq, body] = code.match(/^F([0-9A-F]+)((?:[PS][0-9A-F]+)+)$/);
  const durations = [...body.matchAll(/([PS])([0-9A-F]+)/g)].map(([, k, v]) => (k === "P" ? 1 : -1) * Number.parseInt(v, 16));
  return { carrier: Number.parseInt(freq, 16), durations };
}

/* The hub starts a Raw on a mark: a leading space moves to the end. */
function startOnMark(durations) {
  const d = [...durations];
  if (d[0] < 0) d[d.length - 1] += d.shift();
  return d;
}

describe("encodeIr: Raw codes match IrpTransmogrifier", () => {
  for (const v of vectors.filter((x) => x.press)) {
    it(`${v.protocol} ${v.device},${v.subdevice},${v.function}`, () => {
      const encoded = encodeIr(v.protocol, v.device, v.subdevice, v.function);
      assert.equal(encoded?.mode, "raw");
      const { carrier, durations } = decodeRaw(encoded.code);
      assert.equal(carrier, v.carrier);
      assert.deepEqual(durations, startOnMark(v.press));
      assert.ok(durations[0] > 0 && durations.at(-1) < 0, "starts with a mark, ends with a space");
      assert.ok(encoded.code.length <= 4096);
    });
  }
});

describe("encodeIr: NEC KeyCodes", () => {
  it("NEC1 uses the Toshiba 32 Bit protocol with its NEC repeat frame", () => {
    assert.deepEqual(encodeIr("NEC1", 4, 251, 8), {
      mode: "keycode",
      code: "G:Toshiba 32 Bit:(0x20DF10EF)(Repeat)():3",
      protocolId: 2,
    });
    assert.equal(encodeIr("NEC", 4, -1, 8).code, "G:Toshiba 32 Bit:(0x20DF10EF)(Repeat)():3");
    assert.equal(encodeIr("NEC1-f16", 4, -1, 8).code, "G:Toshiba 32 Bit:(0x20DF10EF)(Repeat)():3");
  });

  it("NEC2 repeats the whole frame, as its IRP does", () => {
    assert.equal(encodeIr("NEC2", 4, 251, 8).code, "G:Toshiba 32 Bit:(0x20DF10EF)(0x20DF10EF)():3");
    const nec2 = vectors.find((x) => x.protocol === "NEC2");
    const nec1 = vectors.find((x) => x.protocol === "NEC1");
    assert.deepEqual(nec2.intro, []);
    assert.equal(nec2.repeat[0], 9024);
    assert.equal(nec1.repeat[1], -2256, "NEC1 holds with the short repeat frame");
  });
});

describe("encodeIr: defaults and limits", () => {
  it("defaults a missing subdevice the way the protocol does", () => {
    const necx = decodeRaw(encodeIr("NECx2", 7, -1, 2).code).durations;
    const necxExplicit = decodeRaw(encodeIr("NECx2", 7, 248, 2).code).durations;
    assert.deepEqual(necx, necxExplicit, "NECx: S = 255 - D");
    const samsung = decodeRaw(encodeIr("Samsung32", 7, -1, 2).code).durations;
    const samsungExplicit = decodeRaw(encodeIr("NECx2", 7, 7, 2).code).durations;
    assert.deepEqual(samsung, samsungExplicit, "Samsung32: the address twice");
  });

  it("takes NEC1-f16's fourth byte when it is given", () => {
    assert.equal(encodeIr("NEC1-f16", 4, 251, 0x12, 0x34).code, "G:Toshiba 32 Bit:(0x20DF482C)(Repeat)():3");
    const text = ["Filetype: IR signals file", "Version: 1", "#", "name: Ext", "type: parsed", "protocol: NECext", "address: 04 FB 00 00", "command: 12 34 00 00"].join("\n");
    assert.equal(parseLibraryText(text, { filename: "x.ir" }).rows[0].code, "G:Toshiba 32 Bit:(0x20DF482C)(Repeat)():3");
  });

  it("returns null for what it can't encode", () => {
    assert.equal(encodeIr("Aiwa", 1, -1, 2), null);
    assert.equal(encodeIr("Sony20", 1, -1, 2), null, "Sony20 needs its subdevice");
    assert.equal(encodeIr("Panasonic", 1, -1, 2), null, "Panasonic needs its subdevice");
    assert.equal(encodeIr("NEC1", 256, -1, 2), null);
    assert.equal(encodeIr("Sony12", 32, -1, 2), null);
    assert.equal(encodeIr("RC5", 1, -1, 128), null);
    assert.equal(encodeIr("NEC1", "x", -1, 2), null);
    assert.equal(encodeIr("Sony12", "", "", ""), null, "an empty cell is not 0");
    assert.equal(encodeIr("NEC1", 4, -1, undefined), null);
  });
});

describe("importer uses the encoder", () => {
  it("imports a Samsung TV row (NECx2) as Raw with a 4.5 ms leader", () => {
    const { rows } = parseLibraryText("functionname,protocol,device,subdevice,function\nPOWER,NECx2,7,7,2\n", { filename: "7,7.csv" });
    assert.equal(rows[0].mode, "raw");
    assert.deepEqual(decodeRaw(rows[0].code).durations.slice(0, 2), [4512, -4512]);
  });

  it("imports Sony rows as three frames, each padded to 45 ms", () => {
    const { rows } = parseLibraryText("functionname,protocol,device,subdevice,function\nVOL+,Sony12,1,-1,18\n", { filename: "1,-1.csv" });
    const { durations } = decodeRaw(rows[0].code);
    const total = durations.reduce((sum, v) => sum + Math.abs(v), 0);
    assert.equal(total, 3 * 45000);
  });

  it("imports Flipper parsed signals through the encoder", () => {
    const text = [
      "Filetype: IR signals file",
      "Version: 1",
      "#",
      "name: Power",
      "type: parsed",
      "protocol: Samsung32",
      "address: 07 00 00 00",
      "command: 02 00 00 00",
      "#",
      "name: Vol_up",
      "type: parsed",
      "protocol: NEC",
      "address: 04 00 00 00",
      "command: 08 00 00 00",
      "#",
      "name: Mute",
      "type: parsed",
      "protocol: SIRC",
      "address: 01 00 00 00",
      "command: 14 00 00 00",
    ].join("\n");
    const { rows } = parseLibraryText(text, { filename: "tv.ir" });
    assert.equal(rows[0].code, encodeIr("Samsung32", 7, -1, 2).code);
    assert.equal(rows[1].code, "G:Toshiba 32 Bit:(0x20DF10EF)(Repeat)():3");
    assert.equal(rows[2].code, encodeIr("Sony12", 1, -1, 20).code);
  });

  it("sets the extended-command bit for Flipper RC5X", () => {
    const text = ["Filetype: IR signals file", "Version: 1", "#", "name: X", "type: parsed", "protocol: RC5X", "address: 00 00 00 00", "command: 05 00 00 00"].join("\n");
    assert.equal(parseLibraryText(text, { filename: "x.ir" }).rows[0].code, encodeIr("RC5", 0, -1, 69).code);
  });

  it("ends a Flipper raw signal that stops on a mark with a gap", () => {
    const text = ["Filetype: IR signals file", "Version: 1", "#", "name: Odd", "type: raw", "frequency: 38000", "duty_cycle: 0.33", "data: 9000 4500 560 560 560"].join("\n");
    const { rows } = parseLibraryText(text, { filename: "odd.ir" });
    assert.match(rows[0].code, /P230SC350$/);
  });

  it("takes one Pronto burst, not the once and repeat bursts joined", () => {
    // 2 once pairs, then 1 repeat pair.
    const raw = prontoToHarmonyRaw("0000 006D 0002 0001 0010 0010 0020 0020 0040 0040");
    assert.equal(decodeRaw(raw).durations.length, 4);
    const repeatOnly = prontoToHarmonyRaw("0000 006D 0000 0002 0010 0010 0020 0020");
    assert.equal(decodeRaw(repeatOnly).durations.length, 4);
  });
});
