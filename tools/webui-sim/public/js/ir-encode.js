/* IR codes from a protocol and its parameters (IRDB's device, subdevice and
   function), in the forms the hub's engine plays correctly:

   - NEC1 and NEC2 become a Harmony KeyCode on the hub's "Toshiba 32 Bit"
     protocol (ProtocolId 2), which has the real NEC repeat frame.
   - Everything else becomes Raw timing. The engine plays a Raw code once per
     press and loops the whole of it while a key is held, so each Raw holds
     the frames one press must send, each padded to its full frame period.

   Timings follow the IRP definitions in IrpTransmogrifier's IrpProtocols.xml
   and were checked against its renderer. Pure functions; no hub data. */

import { harmonyRawFromTimings } from "./views/ir-model.js";

function rev8(v) {
  v = ((v & 240) >> 4) | ((v & 15) << 4);
  v = ((v & 204) >> 2) | ((v & 51) << 2);
  v = ((v & 170) >> 1) | ((v & 85) << 1);
  return v & 255;
}

const lsb = (value, n) => Array.from({ length: n }, (_, i) => (value >> i) & 1);
const msb = (value, n) => Array.from({ length: n }, (_, i) => (value >> (n - 1 - i)) & 1);

/** A frame under construction: signed µs durations (+mark, −space). */
class Frame {
  constructor(unit) {
    this.unit = unit;
    this.d = [];
  }
  /** Durations in units, e.g. add(16, -8). */
  add(...units) {
    for (const u of units) this.d.push(u * this.unit);
    return this;
  }
  /** Bits through a bit spec such as [[1, -1], [1, -3]] (bit 0, bit 1). */
  bits(bits, spec) {
    for (const b of bits) this.add(...spec[b]);
    return this;
  }
  /** Pad with a space so the frame lasts `us` from its start (IRP ^). */
  padTo(us) {
    const total = this.d.reduce((sum, v) => sum + Math.abs(v), 0);
    if (total < us) this.d.push(-(us - total));
    return this;
  }
  /** Merge neighbours of the same sign (bi-phase codes produce them). */
  merged() {
    const out = [];
    for (const v of this.d) {
      if (out.length && Math.sign(out[out.length - 1]) === Math.sign(v)) out[out.length - 1] += v;
      else out.push(v);
    }
    return out;
  }
}

const PULSE_DISTANCE = [[1, -1], [1, -3]];

function necFrame(lead, d, s, f, e) {
  return new Frame(564)
    .add(lead, -8)
    .bits([...lsb(d, 8), ...lsb(s, 8), ...lsb(f, 8), ...lsb(e, 8)], PULSE_DISTANCE)
    .add(1)
    .padTo(108000)
    .merged();
}

function sonyFrame(bits) {
  return new Frame(600).add(4, -1).bits(bits, [[1, -1], [2, -1]]).padTo(45000).merged();
}

function rc5Frame(d, f) {
  const bits = [1, (~f >> 6) & 1, 0, ...msb(d, 5), ...msb(f & 63, 6)];
  return new Frame(889).bits(bits, [[1, -1], [-1, 1]]).padTo(114000).merged();
}

function rc6Frame(d, f) {
  const frame = new Frame(444).add(6, -2).bits([1, 0, 0, 0], [[-1, 1], [1, -1]]);
  frame.add(-2, 2); // toggle bit T=0, double width
  return frame.bits([...msb(d, 8), ...msb(f, 8)], [[-1, 1], [1, -1]]).padTo(107000).merged();
}

function denonSharpFrames(d, f, first, second) {
  const spec = [[1, -3], [1, -7]];
  const a = new Frame(264).bits([...lsb(d, 5), ...lsb(f, 8), ...lsb(first, 2)], spec).add(1).padTo(67000).merged();
  const b = new Frame(264).bits([...lsb(d, 5), ...lsb(~f & 255, 8), ...lsb(second, 2)], spec).add(1).padTo(67000).merged();
  return [...a, ...b];
}

/* Raw for a list of signed durations: starts with a mark (a leading space
   moves to the end, keeping the period), ends with a space. */
function raw(carrier, durations, copies = 1) {
  let d = [...durations];
  if (d[0] < 0) {
    const lead = d.shift();
    d[d.length - 1] += lead;
  }
  const all = Array.from({ length: copies }, () => d).flat();
  const code = harmonyRawFromTimings(carrier, all);
  return code ? { mode: "raw", code } : null;
}

function necKeyCode(d, s, f, e, nec2) {
  const value = ((rev8(d) << 24) | (rev8(s) << 16) | (rev8(f) << 8) | rev8(e)) >>> 0;
  const hex = `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  return { mode: "keycode", code: `G:Toshiba 32 Bit:(${hex})(${nec2 ? hex : "Repeat"})():3`, protocolId: 2 };
}

const byte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

/* IRDB writes "no subdevice" as -1 (or leaves it empty). */
function sub(value) {
  const text = String(value ?? "").trim();
  return text === "" || text === "-1" ? null : Number(text);
}

/** Protocol names this module encodes (IRDB's spelling, case-insensitive). */
export const ENCODABLE = Object.freeze([
  "NEC", "NEC1", "NEC1-f16", "NEC2", "NECx1", "NECx2", "Samsung32", "Pioneer",
  "Sony12", "Sony15", "Sony20", "RC5", "RC6", "Panasonic", "JVC", "Denon", "Sharp",
]);

/* A required number cell: "" or a missing value is not 0. */
function cell(value) {
  const text = String(value ?? "").trim();
  return text === "" ? NaN : Number(text);
}

/**
 * Encode one IRDB-style row. Returns { mode: "keycode" | "raw", code } or
 * null when the protocol or its parameters aren't supported. `e` is NEC1-f16's
 * fourth byte (default ~F), for sources that give it (Flipper's NECext).
 */
export function encodeIr(protocol, device, subdevice, fn, e) {
  const p = String(protocol || "").trim().toLowerCase();
  const d = cell(device);
  const s = sub(subdevice);
  const f = cell(fn);
  if (!Number.isInteger(d) || !Number.isInteger(f) || (s !== null && !Number.isInteger(s))) return null;
  switch (p) {
    case "nec":
    case "nec1":
    case "nec1-f16":
    case "nec2": {
      const ss = s ?? 255 - d;
      const ee = p === "nec1-f16" && e != null && e !== "" ? cell(e) : ~f & 255;
      if (!byte(d) || !byte(ss) || !byte(f) || !byte(ee)) return null;
      return necKeyCode(d, ss, f, ee, p === "nec2");
    }
    case "necx1":
    case "necx2":
    case "samsung32": {
      // Samsung32 is the NECx frame with the address sent twice.
      const ss = s ?? (p === "samsung32" ? d : 255 - d);
      if (!byte(d) || !byte(ss) || !byte(f)) return null;
      return raw(38400, necFrame(8, d, ss, f, ~f & 255));
    }
    case "pioneer": {
      const ss = s ?? 255 - d;
      if (!byte(d) || !byte(ss) || !byte(f)) return null;
      return raw(40000, necFrame(16, d, ss, f, ~f & 255));
    }
    case "sony12":
    case "sony15":
    case "sony20": {
      if (f < 0 || f > 127) return null;
      let bits;
      if (p === "sony12") {
        if (d < 0 || d > 31) return null;
        bits = [...lsb(f, 7), ...lsb(d, 5)];
      } else if (p === "sony15") {
        if (!byte(d)) return null;
        bits = [...lsb(f, 7), ...lsb(d, 8)];
      } else {
        if (d < 0 || d > 31 || s === null || !byte(s)) return null;
        bits = [...lsb(f, 7), ...lsb(d, 5), ...lsb(s, 8)];
      }
      // Sony devices expect three frames per press.
      return raw(40000, sonyFrame(bits), 3);
    }
    case "rc5":
      if (d < 0 || d > 31 || f < 0 || f > 127) return null;
      return raw(36000, rc5Frame(d, f));
    case "rc6":
      if (!byte(d) || !byte(f)) return null;
      return raw(36000, rc6Frame(d, f));
    case "panasonic": {
      if (!byte(d) || s === null || !byte(s) || !byte(f)) return null;
      const frame = new Frame(432)
        .add(8, -4)
        .bits([...lsb(2, 8), ...lsb(32, 8), ...lsb(d, 8), ...lsb(s, 8), ...lsb(f, 8), ...lsb(d ^ s ^ f, 8)], PULSE_DISTANCE)
        .add(1, -173)
        .merged();
      return raw(37000, frame);
    }
    case "jvc": {
      if (!byte(d) || !byte(f)) return null;
      const frame = new Frame(527).add(16, -8).bits([...lsb(d, 8), ...lsb(f, 8)], PULSE_DISTANCE).add(1).padTo(59080).merged();
      return raw(37900, frame);
    }
    case "denon":
      if (d < 0 || d > 31 || !byte(f)) return null;
      return raw(38000, denonSharpFrames(d, f, 0, 3));
    case "sharp":
      if (d < 0 || d > 31 || !byte(f)) return null;
      return raw(38000, denonSharpFrames(d, f, 1, 2));
    default:
      return null;
  }
}
