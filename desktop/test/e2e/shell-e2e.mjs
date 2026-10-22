import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..");
const SIM_PORT = Number(process.env.SIM_PORT || 8799);

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startProdPreviewServer(simPort) {
  const shellDir = path.join(DESKTOP_DIR, "build", "shell");
  const page = fs.readFileSync(path.join(shellDir, "index.html"), "utf8");
  const files = {
    "/assets/harmony-shell.js": [
      path.join(shellDir, "harmony-shell.js"),
      "application/javascript; charset=utf-8",
    ],
    "/assets/harmony-shell.css": [
      path.join(shellDir, "harmony-shell.css"),
      "text/css; charset=utf-8",
    ],
    "/assets/activity-ui.js": [
      path.join(shellDir, "activity-ui.js"),
      "application/javascript; charset=utf-8",
    ],
    "/assets/activity-ui.css": [
      path.join(shellDir, "activity-ui.css"),
      "text/css; charset=utf-8",
    ],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(page);
      return;
    }
    const file = files[url.pathname];
    if (req.method === "GET" && file) {
      res.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-store",
      });
      res.end(fs.readFileSync(file[0]));
      return;
    }
    const proxied = http.request(
      {
        host: "127.0.0.1",
        port: simPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      }
    );
    proxied.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(proxied);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
      });
    });
  });
}

function startAuthProxyServer(simPort) {
  let requireAuth = false;
  const expectedHeader = `Basic ${Buffer.from("owner:hubpass", "utf8").toString("base64")}`;

  const server = http.createServer((req, res) => {
    if (requireAuth && req.headers.authorization !== expectedHeader) {
      res.writeHead(401, {
        "Content-Type": "application/json; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="Harmony Hub Control"',
        "Set-Cookie": "hub_session=secret",
      });
      res.end(JSON.stringify({ ok: false, error: "Authentication required" }));
      return;
    }
    const proxied = http.request(
      {
        host: "127.0.0.1",
        port: simPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      }
    );
    proxied.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(proxied);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        setRequireAuth(val) {
          requireAuth = Boolean(val);
        },
      });
    });
  });
}

test("Playwright _electron end-to-end shell suite against webui-sim", async () => {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "melodious-e2e-userdata-")
  );
  const shotsDir =
    process.env.MELODIOUS_E2E_SCREENSHOT_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "melodious-e2e-shots-"));
  fs.mkdirSync(shotsDir, { recursive: true });

  const simProc = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "tools/webui-sim/server.mjs")],
    {
      env: { ...process.env, PORT: String(SIM_PORT) },
      stdio: "ignore",
    }
  );

  const preview = await startProdPreviewServer(SIM_PORT);
  const authProxy = await startAuthProxyServer(SIM_PORT);
  let electronApp = null;

  try {
    await waitForHttp(`http://127.0.0.1:${SIM_PORT}/api/system-status`);
    await waitForHttp(`http://127.0.0.1:${preview.port}/api/system-status`);

    electronApp = await electron.launch({
      args: [DESKTOP_DIR],
      env: {
        ...process.env,
        MELODIOUS_E2E: "1",
        MELODIOUS_USER_DATA_DIR: userDataDir,
      },
    });

    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. First run shows the Connect screen; connect by address to SIM_PORT
    await page.waitForSelector("#connectForm", { timeout: 10000 });
    assert.equal(await page.title(), "Connect · Melodious");

    await page.fill("#connectHost", "127.0.0.1");
    await page.fill("#connectPort", String(SIM_PORT));

    // Take masked connect screenshot before submitting
    await page.evaluate(() => {
      const h = document.getElementById("connectHost");
      if (h) h.value = "hub.local";
    });
    await page.screenshot({ path: path.join(shotsDir, "connect-1280.png") });
    await page.fill("#connectHost", "127.0.0.1");

    await page.click("#connectBtn");

    // Lands on the shell's Remote tab
    await page.waitForSelector("#view-remote:not([hidden])", { timeout: 10000 });
    assert.equal(await page.title(), "Remote · Melodious");

    // Find first device ID from sim config for device sub-page checks
    const configRes = await fetch(`http://127.0.0.1:${SIM_PORT}/api/activity-config`);
    const configJson = await configRes.json();
    const firstDeviceId = String(
      configJson.deviceList.DevicesWithFeatures[0].Device["Id-"]
    );

    // 2. Open a reference BrowserWindow against prod-preview at 1280x800 and compare every tab & sub-page
    await electronApp.evaluate(async ({ BrowserWindow }, previewPort) => {
      const refWin = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
        },
      });
      refWin.webContents.on("will-prevent-unload", (ev) => ev.preventDefault());
      globalThis.__refWin = refWin;
      await refWin.loadURL(`http://127.0.0.1:${previewPort}/#remote`);
    }, preview.port);

    const allWindows = electronApp.windows();
    const refPage = allWindows.find((w) => w !== page);
    assert.ok(refPage, "Reference prod-preview window should be open");
    await refPage.setViewportSize({ width: 1280, height: 800 });

    const routesToVerify = [
      { hash: "#remote", section: "#view-remote", title: "Remote · Melodious", shot: "remote-1280.png" },
      { hash: "#activities", section: "#view-activities-home", title: "Activities · Melodious", shot: "activities-1280.png" },
      { hash: "#wizard", section: "#view-wizard", title: "Activity setup · Melodious", shot: "wizard-1280.png" },
      { hash: "#editor", section: "#view-activities", title: "Advanced editor · Melodious", shot: "editor-1280.png" },
      { hash: "#devices", section: "#view-devices", title: "Devices · Melodious", shot: "devices-1280.png" },
      { hash: `#devices/${firstDeviceId}`, section: "#view-devices", title: "Devices · Melodious", shot: "device-detail-1280.png" },
      { hash: `#devices/${firstDeviceId}/settings`, section: "#view-devices", title: "Devices · Melodious", shot: "device-settings-1280.png" },
      { hash: `#devices/${firstDeviceId}/sweep`, section: "#view-devices", title: "Devices · Melodious", shot: "device-sweep-1280.png" },
      { hash: "#devices/lab", section: "#view-devices", title: "Devices · Melodious", shot: "ir-lab-1280.png" },
      { hash: "#settings", section: "#view-settings", title: "Settings · Melodious", shot: "settings-1280.png" },
      { hash: "#bluetooth", section: "#view-bluetooth", title: "Bluetooth · Melodious", shot: "bluetooth-1280.png" },
      { hash: "#mqtt", section: "#view-mqtt", title: "MQTT · Melodious", shot: "mqtt-1280.png" },
      { hash: "#wifi", section: "#view-wifi", title: "Wi-Fi · Melodious", shot: "wifi-1280.png" },
      { hash: "#backup", section: "#view-backup", title: "Backup · Melodious", shot: "backup-1280.png" },
      { hash: "#system", section: "#view-system", title: "System · Melodious", shot: "system-1280.png" },
    ];

    for (const r of routesToVerify) {
      await Promise.all([
        page.evaluate((h) => {
          window.location.hash = h;
        }, r.hash),
        refPage.evaluate((h) => {
          window.location.hash = h;
        }, r.hash),
      ]);

      await page.waitForSelector(`${r.section}:not([hidden])`, { timeout: 10000 });
      await refPage.waitForSelector(`${r.section}:not([hidden])`, { timeout: 10000 });
      await wait(350);

      assert.equal(await page.title(), r.title, `Title mismatch on ${r.hash}`);
      assert.equal(await refPage.title(), r.title, `Ref title mismatch on ${r.hash}`);

      // Compare rendered structure and layout metrics at 1280 px between desktop shell and prod-preview
      const [appSnapshot, refSnapshot] = await Promise.all([
        page.evaluate((sel) => {
          const el = document.querySelector(sel);
          const rect = el.getBoundingClientRect();
          const headings = [...el.querySelectorAll("h1,h2,h3")].map((h) =>
            h.textContent.trim()
          );
          const buttons = [...el.querySelectorAll("button,a.btn,a.m-row")].map(
            (b) => b.textContent.trim()
          );
          return {
            width: Math.round(rect.width),
            headings,
            buttonCount: buttons.length,
          };
        }, r.section),
        refPage.evaluate((sel) => {
          const el = document.querySelector(sel);
          const rect = el.getBoundingClientRect();
          const headings = [...el.querySelectorAll("h1,h2,h3")].map((h) =>
            h.textContent.trim()
          );
          const buttons = [...el.querySelectorAll("button,a.btn,a.m-row")].map(
            (b) => b.textContent.trim()
          );
          return {
            width: Math.round(rect.width),
            headings,
            buttonCount: buttons.length,
          };
        }, r.section),
      ]);

      assert.deepEqual(
        appSnapshot,
        refSnapshot,
        `Desktop shell vs prod-preview layout mismatch on ${r.hash}`
      );

      await page.screenshot({ path: path.join(shotsDir, r.shot) });
    }

    await electronApp.evaluate(() => {
      if (globalThis.__refWin && !globalThis.__refWin.isDestroyed()) {
        globalThis.__refWin.close();
      }
    });

    // 3. Download shows the Save dialog (will-download -> showSaveDialog)
    const downloadSavedPath = path.join(userDataDir, "downloaded-bundle.json");
    await electronApp.evaluate((_electron, targetPath) => {
      globalThis.__saveDialogCalls = [];
      globalThis.__melodiousShowSaveDialog = (_win, opts) => {
        globalThis.__saveDialogCalls.push(opts);
        return targetPath;
      };
    }, downloadSavedPath);

    await page.evaluate(() => {
      window.location.hash = "#backup";
    });
    await page.waitForSelector("#view-backup:not([hidden])");
    await page.evaluate(() => {
      document.querySelector('a[href="/export/bundle"]')?.click();
    });

    const deadline = Date.now() + 5000;
    let saveCalls = [];
    while (Date.now() < deadline) {
      saveCalls = await electronApp.evaluate(() => globalThis.__saveDialogCalls || []);
      if (saveCalls.length > 0 && fs.existsSync(downloadSavedPath)) break;
      await wait(100);
    }
    assert.equal(saveCalls.length, 1, "Download should trigger showSaveDialogSync");
    assert.equal(saveCalls[0].defaultPath, "harmony-owner-bundle.json");
    assert.equal(fs.existsSync(downloadSavedPath), true);
    const bundleData = JSON.parse(fs.readFileSync(downloadSavedPath, "utf8"));
    assert.equal(bundleData.format, "harmony-owner-bundle-v2");

    // 4. Desktop Settings (⌘, / Menu -> Settings…)
    await electronApp.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const appSubmenu = menu.items[0]?.submenu;
      const settingsItem = appSubmenu?.items.find((i) => i.label === "Settings…");
      settingsItem?.click();
    });
    await page.waitForSelector("#connectRoot", { timeout: 10000 });
    assert.equal(await page.title(), "Settings · Melodious");
    assert.ok(await page.isVisible("#forgetHubBtn"));
    assert.ok(await page.isVisible("#clientIdInput"));

    // Mask address on settings page before screenshot
    await page.evaluate(() => {
      const addr = document.getElementById("currentHubAddress");
      if (addr) addr.textContent = "hub.local:8080";
      const host = document.getElementById("connectHost");
      if (host) host.value = "hub.local";
    });
    await page.screenshot({ path: path.join(shotsDir, "desktop-settings-1280.png") });

    // Point at authProxy port from Settings, then enable auth on authProxy to test 401 in the shell
    await page.fill("#connectHost", "127.0.0.1");
    await page.fill("#connectPort", String(authProxy.port));
    await page.click("#connectBtn");
    await page.waitForSelector("#view-remote:not([hidden])", { timeout: 10000 });

    // 5. A 401 from the hub opens the hub sign-in sheet; saving credentials authenticates and reloads
    authProxy.setRequireAuth(true);
    await page.evaluate(() => {
      fetch("/api/activity-config").catch(() => {});
    });

    await page.waitForSelector("dialog#hubSignInSheet[open]", { timeout: 10000 });
    await wait(450);
    await page.evaluate(() => {
      const p = document.querySelector("#hubSignInSheet .sheet-text");
      if (p) p.textContent = "Enter the username and password for hub.local.";
    });
    await page.screenshot({ path: path.join(shotsDir, "hub-signin-sheet-1280.png") });
    await page.fill("#hubSignInUser", "owner");
    await page.fill("#hubSignInPass", "hubpass");
    await page.click("#hubSignInSubmit");

    await page.waitForSelector("#view-remote:not([hidden])", { timeout: 10000 });
    await wait(300);
    assert.equal(await page.locator("dialog#hubSignInSheet").count(), 0);

    // Verify subsequent requests succeed with the saved Basic auth header
    const statusAfterAuth = await page.evaluate(async () => {
      const res = await fetch("/api/system-status");
      return res.status;
    });
    assert.equal(statusAfterAuth, 200);

    // 6. Navigation to another origin is cancelled; https: window.open goes to shell.openExternal
    await electronApp.evaluate(() => {
      globalThis.__externalOpened = [];
      globalThis.__melodiousOpenExternal = async (url) => {
        globalThis.__externalOpened.push(url);
      };
    });

    await page.evaluate(() => {
      window.open("https://example.com/docs", "_blank");
      window.open("http://example.com/insecure", "_blank");
    });
    await wait(200);
    const externalOpened = await electronApp.evaluate(
      () => globalThis.__externalOpened || []
    );
    assert.deepEqual(externalOpened, ["https://example.com/docs"]);
    assert.equal(electronApp.windows().length, 1);

    await page.evaluate(() => {
      window.location.href = "https://example.com/should-be-cancelled";
    });
    await wait(300);
    assert.ok(page.url().startsWith("melodious://app/"));

    // 7. Unreachable hub returns 502 and offers the connect screen
    authProxy.server.closeAllConnections?.();
    await new Promise((r) => authProxy.server.close(r));
    const status502 = await page.evaluate(async () => {
      const res = await fetch("/api/system-status");
      return res.status;
    });
    assert.equal(status502, 502);
    const hasConnectBtn = await page.evaluate(() =>
      Boolean(document.getElementById("openConnectScreenBtn"))
    );
    assert.equal(hasConnectBtn, true);
    await page.evaluate(() => {
      document.getElementById("openConnectScreenBtn")?.click();
    });
    await page.waitForSelector("#connectForm", { timeout: 10000 });
    assert.equal(await page.title(), "Connect · Melodious");
  } finally {
    if (electronApp) {
      await electronApp.close();
    }
    simProc.kill();
    preview.server.closeAllConnections?.();
    authProxy.server.closeAllConnections?.();
    await new Promise((r) => preview.server.close(() => r()));
    await new Promise((r) => authProxy.server.close(() => r()));
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (!process.env.MELODIOUS_E2E_SCREENSHOT_DIR) {
      fs.rmSync(shotsDir, { recursive: true, force: true });
    }
  }
});
