"use strict";

// electron-builder afterPack hook (runs before signing): give the main
// executable its own LC_UUID so macOS Local Network privacy treats Melodious
// as its own app. See macho-uuid.js.

const path = require("node:path");
const { appUuid, patchExecutable } = require("./macho-uuid");

const ARCH_NAMES = { 1: "x64", 3: "arm64" }; // builder-util Arch enum

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const arch = ARCH_NAMES[context.arch];
  if (!arch) throw new Error(`afterPack: unexpected arch ${context.arch}`);
  const { appInfo } = context.packager;
  const exe = path.join(context.appOutDir, `${appInfo.productFilename}.app`, "Contents", "MacOS", appInfo.productFilename);
  const uuid = appUuid(appInfo.id, arch);
  const { before, after } = patchExecutable(exe, uuid);
  if (after !== uuid) throw new Error(`afterPack: LC_UUID is ${after}, expected ${uuid}`);
  console.log(`  • afterPack: ${arch} main executable LC_UUID ${before} -> ${after}`);
};
