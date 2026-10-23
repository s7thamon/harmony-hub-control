import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readUuid, appUuid, setUuid, findUuidOffset } = require("../scripts/macho-uuid.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STOCK_ELECTRON = path.resolve(__dirname, "../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");

/** A minimal thin 64-bit Mach-O header: one LC_SEGMENT_64 stub, then LC_UUID. */
function fakeMachO(uuidHex = "00112233445566778899aabbccddeeff") {
  const seg = Buffer.alloc(72);
  seg.writeUInt32LE(0x19, 0);
  seg.writeUInt32LE(72, 4);
  const uuid = Buffer.alloc(24);
  uuid.writeUInt32LE(0x1b, 0);
  uuid.writeUInt32LE(24, 4);
  Buffer.from(uuidHex, "hex").copy(uuid, 8);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(2, 16);
  header.writeUInt32LE(seg.length + uuid.length, 20);
  return Buffer.concat([header, seg, uuid, Buffer.alloc(64)]);
}

test("macho-uuid reads and rewrites LC_UUID and leaves every other byte alone", () => {
  const buf = fakeMachO();
  assert.equal(readUuid(buf), "00112233-4455-6677-8899-AABBCCDDEEFF");
  const before = Buffer.from(buf);
  setUuid(buf, "12345678-9ABC-5DEF-8123-456789ABCDEF");
  assert.equal(readUuid(buf), "12345678-9ABC-5DEF-8123-456789ABCDEF");
  const at = findUuidOffset(buf);
  for (let i = 0; i < buf.length; i++) {
    if (i < at || i >= at + 16) assert.equal(buf[i], before[i], `byte ${i} changed`);
  }
});

test("macho-uuid refuses fat, 32-bit, truncated and UUID-less files", () => {
  const fat = Buffer.alloc(64);
  fat.writeUInt32BE(0xcafebabe, 0);
  assert.throws(() => readUuid(fat), /thin 64-bit/);
  assert.throws(() => readUuid(Buffer.alloc(8)), /thin 64-bit/);
  const noUuid = fakeMachO();
  noUuid.writeUInt32LE(1, 16); // only the segment command remains
  assert.throws(() => readUuid(noUuid), /no LC_UUID/);
  const runaway = fakeMachO();
  runaway.writeUInt32LE(1_000_000, 20);
  assert.throws(() => readUuid(runaway), /past the file/);
  assert.throws(() => setUuid(fakeMachO(), "not-a-uuid"), /bad UUID/);
});

test("appUuid is stable per app and arch, distinct across arches, version-5 shaped", () => {
  const a = appUuid("app.melodious.desktop", "arm64");
  assert.equal(a, appUuid("app.melodious.desktop", "arm64"));
  assert.notEqual(a, appUuid("app.melodious.desktop", "x64"));
  assert.notEqual(a, appUuid("other.app", "arm64"));
  assert.match(a, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});

test("the stock Electron executable patches in memory to Melodious's UUID", { skip: !fs.existsSync(STOCK_ELECTRON) && "electron not installed" }, () => {
  const buf = fs.readFileSync(STOCK_ELECTRON);
  const stock = readUuid(buf);
  const want = appUuid("app.melodious.desktop", process.arch);
  assert.notEqual(stock, want);
  setUuid(buf, want);
  assert.equal(readUuid(buf), want);
  assert.equal(buf.length, fs.statSync(STOCK_ELECTRON).size);
});
