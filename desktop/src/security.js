"use strict";

const MAIN_ORIGIN = "melodious://app";

function isAllowedNavigationUrl(rawUrl) {
  const s = String(rawUrl ?? "");
  if (!s || /[\r\n\u0000\\]/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "melodious:" && u.host === "app";
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(rawUrl) {
  const s = String(rawUrl ?? "");
  if (!s || /[\r\n\u0000\\]/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function isTrustedIpcSender(event, mainWindow) {
  if (!event || !mainWindow || mainWindow.isDestroyed?.()) return false;
  const wc = mainWindow.webContents;
  if (!wc || event.sender !== wc) return false;
  if (wc.mainFrame && event.senderFrame && event.senderFrame !== wc.mainFrame) {
    return false;
  }
  const frameUrl =
    event.senderFrame?.url ||
    (typeof wc.getURL === "function" ? wc.getURL() : "");
  return isAllowedNavigationUrl(frameUrl);
}

function attachWindowSecurity({ win, openExternal } = {}) {
  const wc = win.webContents;

  wc.on("will-prevent-unload", (event) => {
    event.preventDefault();
  });

  wc.on("will-navigate", (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/export/")) {
        event.preventDefault();
        if (typeof wc.downloadURL === "function") {
          setImmediate(() => {
            if (!wc.isDestroyed?.()) wc.downloadURL(url);
          });
        }
      }
    } catch {}
  });

  wc.on("will-redirect", (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
    }
  });

  wc.on("will-frame-navigate", (event) => {
    if (!isAllowedNavigationUrl(event.url)) {
      event.preventDefault();
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url) && typeof openExternal === "function") {
      Promise.resolve(openExternal(url)).catch(() => {});
    }
    return { action: "deny" };
  });
}

function attachSessionSecurity({ ses, getMainWindow, showSaveDialog } = {}) {
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  ses.setPermissionCheckHandler(() => false);

  if (typeof ses.setDevicePermissionHandler === "function") {
    ses.setDevicePermissionHandler(() => false);
  }

  ses.on("will-download", (event, item) => {
    const win = typeof getMainWindow === "function" ? getMainWindow() : null;
    const filename =
      typeof item.getFilename === "function" ? item.getFilename() : "download";
    const savePath =
      typeof showSaveDialog === "function"
        ? showSaveDialog(win, { defaultPath: filename })
        : undefined;
    if (savePath && typeof savePath === "string") {
      item.setSavePath(savePath);
    } else {
      event.preventDefault();
    }
  });
}

module.exports = {
  MAIN_ORIGIN,
  isAllowedNavigationUrl,
  isAllowedExternalUrl,
  isTrustedIpcSender,
  attachWindowSecurity,
  attachSessionSecurity,
};
