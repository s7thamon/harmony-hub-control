import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* Checks the built Melodious.app in dist/ (run `npm run dist` first): its
   signature, Info.plist and contents, then launches it against the webui-sim.
   It never signs in to Logitech and never contacts a real hub. The app runs with
   Chromium's --use-mock-keychain, so it doesn't touch the login Keychain. */

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");
const asar = require("@electron/asar");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..");
const SHELL_DIR = path.join(DESKTOP_DIR, "build", "shell");
const SIM_PORT = Number(process.env.SIM_PORT || 8798);

const APPS = [
  { arch: "arm64", dir: path.join(DESKTOP_DIR, "dist", "mac-arm64", "Melodious.app") },
  { arch: "x64", dir: path.join(DESKTOP_DIR, "dist", "mac", "Melodious.app") },
];

const SHELL_FILES = ["index.html", "harmony-shell.js", "harmony-shell.css", "activity-ui.js", "activity-ui.css"];
const SRC_FILES = [
  "src/main.js", "src/preload.js", "src/scheme.js", "src/security.js", "src/settings.js",
  "src/discovery.js", "src/ipc.js", "src/catalog/oauth.js", "src/catalog/client.js",
  "src/catalog/signin-window.js", "src/connect/index.html", "src/connect/connect.js",
];

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function canRun(arch) {
  if (arch === process.arch) return true;
  // x64 on Apple silicon needs Rosetta.
  return arch === "x64" && spawnSync("arch", ["-x86_64", "/usr/bin/true"]).status === 0;
}

function infoPlist(appDir) {
  const out = spawnSync("plutil", ["-convert", "json", "-o", "-", path.join(appDir, "Contents", "Info.plist")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

function checkBundle(appDir, arch) {
  const sig = spawnSync("codesign", ["-dv", "--verbose=2", appDir], { encoding: "utf8" });
  assert.equal(sig.status, 0, sig.stderr);
  assert.match(sig.stderr, /Signature=adhoc/);
  assert.match(sig.stderr, /TeamIdentifier=not set/);
  assert.doesNotMatch(sig.stderr, /flags=.*runtime/, "hardened runtime is off for ad-hoc signing");
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appDir], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);

  const lipo = spawnSync("lipo", ["-archs", path.join(appDir, "Contents", "MacOS", "Melodious")], { encoding: "utf8" });
  assert.equal(lipo.stdout.trim(), arch === "x64" ? "x86_64" : "arm64", "one architecture per build");

  const plist = infoPlist(appDir);
  assert.equal(plist.CFBundleIdentifier, "app.melodious.desktop");
  assert.equal(plist.CFBundleName, "Melodious");
  assert.equal(plist.CFBundleShortVersionString, require(path.join(DESKTOP_DIR, "package.json")).version);
  // No system components: no URL scheme handler, no update feed, no login item.
  for (const key of ["CFBundleURLTypes", "SUFeedURL", "SMPrivilegedExecutables", "LSUIElement", "LSBackgroundOnly"]) {
    assert.equal(plist[key], undefined, `Info.plist must not carry ${key}`);
  }
  const resources = path.join(appDir, "Contents", "Resources");
  assert.equal(fs.existsSync(path.join(resources, "app-update.yml")), false, "no auto-update config");
  assert.equal(fs.existsSync(path.join(appDir, "Contents", "Library", "LoginItems")), false, "no login item");
  assert.equal(fs.existsSync(path.join(resources, "icon.icns")), true);

  // The app carries exactly src/ and the staged shell, and the shell is
  // byte-identical to what bundle-shell.sh staged from codex_webui's bundle.
  const archive = path.join(resources, "app.asar");
  const files = asar.listPackage(archive).map((f) => f.replace(/^\//, "").split(path.sep).join("/"));
  const expected = ["package.json", ...SRC_FILES, ...SHELL_FILES.map((f) => `build/shell/${f}`)].sort();
  const actualFiles = files.filter((f) => {
    const stat = asar.statFile(archive, f);
    return !stat.files;
  }).sort();
  assert.deepEqual(actualFiles, expected);
  for (const f of SHELL_FILES) {
    const packed = asar.extractFile(archive, `build/shell/${f}`);
    assert.ok(packed.equals(fs.readFileSync(path.join(SHELL_DIR, f))), `${f} matches build/shell`);
  }
}

for (const { arch, dir } of APPS) {
  const skip = !fs.existsSync(dir)
    ? `${dir} not built (npm run dist)`
    : !canRun(arch) ? `cannot run ${arch} on this Mac` : false;

  test(`packaged Melodious.app (${arch}): bundle, launch against webui-sim, catalog tab`, { timeout: 120_000, skip }, async () => {
    checkBundle(dir, arch);

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodious-dist-userdata-"));
    const simProc = spawn(process.execPath, [path.join(REPO_ROOT, "tools/webui-sim/server.mjs")], {
      env: { ...process.env, PORT: String(SIM_PORT) },
      stdio: "ignore",
    });
    let electronApp = null;
    try {
      await waitForHttp(`http://127.0.0.1:${SIM_PORT}/api/system-status`);
      electronApp = await electron.launch({
        executablePath: path.join(dir, "Contents", "MacOS", "Melodious"),
        args: ["--use-mock-keychain"],
        env: {
          ...process.env,
          // A packaged app must ignore the source-only test hooks.
          MELODIOUS_E2E: "1",
          MELODIOUS_USER_DATA_DIR: userDataDir,
          MELODIOUS_INITIAL_HOST: "127.0.0.1",
          MELODIOUS_INITIAL_PORT: String(SIM_PORT),
        },
      });
      assert.equal(await electronApp.evaluate(({ app }) => app.isPackaged), true);

      const page = await electronApp.firstWindow();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForSelector("#view-remote:not([hidden])", { timeout: 20000 });
      assert.equal(await page.title(), "Remote · Melodious");
      assert.ok(page.url().startsWith("melodious://app/"), page.url());

      const bridge = await page.evaluate(() => ({
        version: window.melodiousDesktop?.version,
        catalog: Object.keys(window.melodiousDesktop?.catalog ?? {}).sort(),
        node: typeof window.require,
      }));
      assert.equal(bridge.version, 1);
      assert.deepEqual(bridge.catalog, ["checkModel", "download", "search", "signIn", "signOut", "status"]);
      assert.equal(bridge.node, "undefined");

      // The stub catalog service the source e2e uses must be ignored here.
      await electronApp.evaluate(() => {
        globalThis.__melodiousCatalogService = { status: async () => ({ signedIn: true, stub: true }) };
      });
      const status = await page.evaluate(() => window.melodiousDesktop.catalog.status());
      assert.deepEqual(status, { signedIn: false });

      // The catalog tab shows the app's sign-in, with nothing sent to Logitech.
      const labId = await page.evaluate(async () => {
        const r = await fetch("/api/ir-lab-target", { method: "POST", body: "" });
        return (await r.json()).deviceId;
      });
      assert.ok(labId);
      await page.evaluate((id) => { window.location.hash = `#devices/${id}`; }, labId);
      await page.reload();
      await page.getByRole("tab", { name: /^Commands/ }).click();
      await page.getByRole("button", { name: "Import codes", exact: true }).click();
      await page.getByRole("tab", { name: "Logitech catalog" }).click();
      const panel = page.locator('[role="tabpanel"][id$="panel-catalog"]');
      await panel.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      await panel.getByRole("button", { name: "Search Logitech catalog" }).waitFor();
      await panel.getByText("Open a catalog package…").first().waitFor();

      if (process.env.MELODIOUS_DIST_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.MELODIOUS_DIST_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.MELODIOUS_DIST_SCREENSHOT_DIR, `packaged-catalog-${arch}.png`) });
      }
      console.log(`packaged ${arch}: ad-hoc signed, no URL types/update feed/login item, shell byte-identical, launched, catalog tab ready: OK`);
    } finally {
      if (electronApp) {
        // E2E quit-on-close is off in a packaged app, so quit explicitly.
        const proc = electronApp.process();
        await Promise.race([
          electronApp.evaluate(({ app }) => app.quit()).catch(() => {}),
          wait(5000),
        ]);
        await Promise.race([electronApp.close().catch(() => {}), wait(5000)]);
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
      simProc.kill();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
}
