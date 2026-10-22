import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isAllowedNavigationUrl,
  isAllowedExternalUrl,
  isTrustedIpcSender,
  attachWindowSecurity,
  attachSessionSecurity,
} = require("../src/security.js");

test("isAllowedNavigationUrl locks navigation to melodious://app", () => {
  assert.equal(isAllowedNavigationUrl("melodious://app/"), true);
  assert.equal(isAllowedNavigationUrl("melodious://app/#remote"), true);
  assert.equal(isAllowedNavigationUrl("melodious://app/index.html"), true);

  assert.equal(isAllowedNavigationUrl("melodious://other/"), false);
  assert.equal(isAllowedNavigationUrl("melodious://user@app/"), false);
  assert.equal(isAllowedNavigationUrl("https://accounts.logi.com/"), false);
  assert.equal(isAllowedNavigationUrl("http://127.0.0.1:8799/"), false);
  assert.equal(isAllowedNavigationUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedNavigationUrl("javascript:alert(1)"), false);
});

test("isAllowedExternalUrl allows only https: URLs", () => {
  assert.equal(isAllowedExternalUrl("https://github.com/schlambos/harmony-hub-control"), true);
  assert.equal(isAllowedExternalUrl("http://example.com"), false);
  assert.equal(isAllowedExternalUrl("file:///Applications/Calculator.app"), false);
  assert.equal(isAllowedExternalUrl("com.logitech.harmony://lidsoauth"), false);
});

test("isTrustedIpcSender accepts only main window top frame on melodious://app", () => {
  const mainFrame = { url: "melodious://app/#remote" };
  const subFrame = { url: "melodious://app/#remote" };
  const wc = { mainFrame, getURL: () => "melodious://app/#remote" };
  const win = { isDestroyed: () => false, webContents: wc };
  assert.equal(isTrustedIpcSender({ sender: wc }, win), false);

  assert.equal(
    isTrustedIpcSender({ sender: wc, senderFrame: mainFrame }, win),
    true
  );
  assert.equal(
    isTrustedIpcSender({ sender: wc, senderFrame: subFrame }, win),
    false
  );
  assert.equal(
    isTrustedIpcSender(
      { sender: wc, senderFrame: { url: "https://evil.example/" } },
      win
    ),
    false
  );
  assert.equal(
    isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, win),
    false
  );
});

test("attachWindowSecurity cancels non-app navigation, routes /export/* to downloadURL, and opens only https: popups externally", async () => {
  const wc = new EventEmitter();
  let windowOpenHandler = null;
  const downloadedUrls = [];
  wc.setWindowOpenHandler = (fn) => {
    windowOpenHandler = fn;
  };
  wc.downloadURL = (u) => {
    downloadedUrls.push(u);
  };
  const openedExternally = [];
  attachWindowSecurity({
    win: { webContents: wc },
    openExternal: (url) => openedExternally.push(url),
  });

  let prevented = false;
  wc.emit("will-navigate", { preventDefault: () => (prevented = true) }, "https://example.com");
  assert.equal(prevented, true);

  prevented = false;
  wc.emit("will-navigate", { preventDefault: () => (prevented = true) }, "melodious://app/#devices");
  assert.equal(prevented, false);

  prevented = false;
  wc.emit(
    "will-navigate",
    { preventDefault: () => (prevented = true) },
    "melodious://app/export/bundle"
  );
  assert.equal(prevented, true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(downloadedUrls, ["melodious://app/export/bundle"]);

  assert.deepEqual(windowOpenHandler({ url: "https://example.com/docs" }), { action: "deny" });
  assert.deepEqual(openedExternally, ["https://example.com/docs"]);

  assert.deepEqual(windowOpenHandler({ url: "http://example.com/insecure" }), { action: "deny" });
  assert.equal(openedExternally.length, 1);
});

test("attachSessionSecurity denies all permissions and routes downloads through Save dialog", () => {
  const ses = new EventEmitter();
  let permReqHandler = null;
  let permCheckHandler = null;
  ses.setPermissionRequestHandler = (fn) => {
    permReqHandler = fn;
  };
  ses.setPermissionCheckHandler = (fn) => {
    permCheckHandler = fn;
  };

  let nextSavePath = "/tmp/saved-bundle.json";
  const dialogCalls = [];
  attachSessionSecurity({
    ses,
    getMainWindow: () => ({ id: 1 }),
    showSaveDialog: (_win, opts) => {
      dialogCalls.push(opts);
      return nextSavePath;
    },
  });

  let granted = true;
  permReqHandler({}, "media", (res) => {
    granted = res;
  });
  assert.equal(granted, false);
  assert.equal(permCheckHandler({}, "geolocation"), false);

  // Download confirmed in Save dialog
  let chosenPath = null;
  let downloadCancelled = false;
  ses.emit(
    "will-download",
    { preventDefault: () => (downloadCancelled = true) },
    {
      getFilename: () => "harmony-owner-bundle.json",
      setSavePath: (p) => {
        chosenPath = p;
      },
    }
  );
  assert.equal(dialogCalls.length, 1);
  assert.equal(dialogCalls[0].defaultPath, "harmony-owner-bundle.json");
  assert.equal(chosenPath, "/tmp/saved-bundle.json");
  assert.equal(downloadCancelled, false);

  // Download cancelled in Save dialog
  nextSavePath = undefined;
  chosenPath = null;
  ses.emit(
    "will-download",
    { preventDefault: () => (downloadCancelled = true) },
    {
      getFilename: () => "harmony-owner-bundle.json",
      setSavePath: (p) => {
        chosenPath = p;
      },
    }
  );
  assert.equal(chosenPath, null);
  assert.equal(downloadCancelled, true);
});
