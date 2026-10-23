"use strict";

// Give the packaged main executable its own LC_UUID.
//
// macOS Local Network privacy identifies an app by its main executable's
// LC_UUID (Apple TN3179). Electron's prebuilt executable has the same UUID in
// every app on the same Electron version and arch, so without this macOS
// files Melodious under whichever Electron app it saw first (often the
// development Electron.app): no prompt, and LAN connections to the hub fail.
// See electron/electron#55101.
//
// The UUID is derived from the bundle id and arch, so it stays the same across
// versions and the user's Local Network permission survives updates. This
// must run before signing (electron-builder's afterPack).

const crypto = require("node:crypto");
const fs = require("node:fs");

const MH_MAGIC_64 = 0xfeedfacf;
const LC_UUID = 0x1b;

function findUuidOffset(buf) {
  if (buf.length < 32 || buf.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error("not a thin 64-bit little-endian Mach-O executable");
  }
  const ncmds = buf.readUInt32LE(16);
  const sizeofcmds = buf.readUInt32LE(20);
  const end = 32 + sizeofcmds;
  if (end > buf.length) throw new Error("Mach-O load commands run past the file");
  let off = 32;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > end) throw new Error("truncated Mach-O load command");
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmdsize < 8 || off + cmdsize > end) throw new Error("bad Mach-O load command size");
    if (cmd === LC_UUID) {
      if (cmdsize !== 24) throw new Error("bad LC_UUID size");
      return off + 8;
    }
    off += cmdsize;
  }
  throw new Error("Mach-O executable has no LC_UUID");
}

function formatUuid(bytes) {
  const h = Buffer.from(bytes).toString("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function readUuid(buf) {
  const at = findUuidOffset(buf);
  return formatUuid(buf.subarray(at, at + 16));
}

/** A stable name-based UUID (version 5 layout) for one app and arch. */
function appUuid(appId, arch) {
  const b = crypto.createHash("sha256").update(`melodious-lc-uuid:${appId}:${arch}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

function setUuid(buf, uuid) {
  const bytes = Buffer.from(String(uuid).replace(/-/g, ""), "hex");
  if (bytes.length !== 16) throw new Error(`bad UUID ${uuid}`);
  const at = findUuidOffset(buf);
  bytes.copy(buf, at);
  return buf;
}

function patchExecutable(file, uuid) {
  const buf = fs.readFileSync(file);
  const before = readUuid(buf);
  setUuid(buf, uuid);
  fs.writeFileSync(file, buf);
  return { before, after: readUuid(fs.readFileSync(file)) };
}

module.exports = { LC_UUID, findUuidOffset, readUuid, appUuid, setUuid, patchExecutable };
