"use strict";

const {
  OAUTH_SCHEME,
  DEFAULT_CLIENT_ID,
  pkcePair,
  authorizeUrl,
  parseCallback,
  oauthExchange,
} = require("./oauth");

const SIGNIN_PARTITION = "logitech-signin";

function isCallbackUrl(rawUrl) {
  const s = String(rawUrl ?? "").trim();
  return s.toLowerCase().startsWith(OAUTH_SCHEME);
}

function isAllowedSignInNavigationUrl(rawUrl) {
  const s = String(rawUrl ?? "").trim();
  if (!s || /[\r\n\u0000\\]/.test(s)) return false;
  if (s === "about:blank" || s === "about://blank") return true;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function getDefaultElectron() {
  const electron = require("electron");
  if (!electron || typeof electron !== "object") {
    throw new Error("Electron runtime is required to open the sign-in window");
  }
  return electron;
}

/**
 * Open a sandboxed, in-memory BrowserWindow for Logitech OAuth sign-in,
 * catch the com.logitech.harmony://lidsoauth redirect in-app, exchange
 * the authorization code with PKCE, and close the window on the first catch.
 *
 * Returns `{ cancelled: false, tokens }` on success, or
 * `{ cancelled: true, tokens: null }` if the user closes the window before
 * completing sign-in.
 */
async function runSignInWindow({
  client,
  clientId = DEFAULT_CLIENT_ID,
  parentWindow = null,
  pkce = null,
  createWindow = null,
  getSession = null,
} = {}) {
  const { verifier, challenge, state } = pkce || pkcePair();
  const targetUrl = authorizeUrl({ clientId, challenge, state });

  const ses =
    typeof getSession === "function"
      ? getSession(SIGNIN_PARTITION)
      : getDefaultElectron().session.fromPartition(SIGNIN_PARTITION, {
          cache: false,
        });

  if (typeof ses.clearStorageData === "function") {
    // Do not silently reuse an old account if clearing cookies fails.
    await ses.clearStorageData();
  }
  if (typeof ses.setPermissionRequestHandler === "function") {
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  }
  if (typeof ses.setPermissionCheckHandler === "function") {
    ses.setPermissionCheckHandler(() => false);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackHandled = false;
    const popups = new Set();

    const winOptions = {
      width: 520,
      height: 760,
      title: "Sign in to Logitech · Melodious",
      backgroundColor: "#0e1014",
      ...(parentWindow && !parentWindow.isDestroyed?.()
        ? { parent: parentWindow }
        : {}),
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    };

    const win =
      typeof createWindow === "function"
        ? createWindow(winOptions)
        : new (getDefaultElectron().BrowserWindow)(winOptions);

    ses.setDevicePermissionHandler?.(() => false);
    const denyDownload = (event) => event.preventDefault();
    ses.on?.("will-download", denyDownload);

    const closeAllWindows = () => {
      for (const popup of popups) {
        try {
          if (!popup.isDestroyed?.()) popup.close();
        } catch {}
      }
      popups.clear();
      try {
        if (!win.isDestroyed?.()) win.close();
      } catch {}
    };

    const cleanupRedirectHook = () => {
      ses.removeListener?.("will-download", denyDownload);
      try {
        if (ses?.webRequest && typeof ses.webRequest.onBeforeRedirect === "function") {
          ses.webRequest.onBeforeRedirect(null);
        }
      } catch {}
    };

    const handleCallback = (rawUrl) => {
      if (callbackHandled || settled) return;
      callbackHandled = true;
      settled = true;
      cleanupRedirectHook();
      closeAllWindows();

      let code;
      try {
        code = parseCallback(rawUrl, { expectedState: state });
      } catch (err) {
        reject(err);
        return;
      }

      Promise.resolve()
        .then(() => oauthExchange(client, { clientId, code, verifier }))
        .then((tokens) => resolve({ cancelled: false, tokens }))
        .catch((err) => reject(err));
    };

    const attachGuards = (wc) => {
      if (!wc || typeof wc.on !== "function") return;
      wc.on("will-prevent-unload", (event) => event.preventDefault());

      wc.on("will-redirect", (event, url) => {
        url = url || event?.url;
        if (isCallbackUrl(url)) {
          event?.preventDefault?.();
          handleCallback(url);
          return;
        }
        if (!isAllowedSignInNavigationUrl(url)) {
          event?.preventDefault?.();
        }
      });

      wc.on("will-navigate", (event, url) => {
        url = url || event?.url;
        if (isCallbackUrl(url)) {
          event?.preventDefault?.();
          handleCallback(url);
          return;
        }
        if (!isAllowedSignInNavigationUrl(url)) {
          event?.preventDefault?.();
        }
      });

      wc.on("will-frame-navigate", (event) => {
        const url = event?.url;
        if (isCallbackUrl(url)) {
          event?.preventDefault?.();
          handleCallback(url);
          return;
        }
        if (!isAllowedSignInNavigationUrl(url)) {
          event?.preventDefault?.();
        }
      });

      if (typeof wc.setWindowOpenHandler === "function") {
        wc.setWindowOpenHandler(({ url }) => {
          if (isCallbackUrl(url)) {
            handleCallback(url);
            return { action: "deny" };
          }
          if (!isAllowedSignInNavigationUrl(url) || !url.startsWith("https:")) {
            return { action: "deny" };
          }
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              parent: win,
              backgroundColor: "#0e1014",
              webPreferences: {
                session: ses,
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: true,
              },
            },
          };
        });
      }

      wc.on("did-create-window", (childWin) => {
        popups.add(childWin);
        childWin.on?.("closed", () => {
          popups.delete(childWin);
        });
        attachGuards(childWin.webContents);
      });
    };

    if (ses?.webRequest && typeof ses.webRequest.onBeforeRedirect === "function") {
      ses.webRequest.onBeforeRedirect((details) => {
        const redirectUrl = details?.redirectURL;
        if (isCallbackUrl(redirectUrl)) {
          handleCallback(redirectUrl);
        }
      });
    }

    attachGuards(win.webContents);

    win.on("closed", () => {
      cleanupRedirectHook();
      for (const popup of popups) {
        try {
          if (!popup.isDestroyed?.()) popup.close();
        } catch {}
      }
      popups.clear();
      if (!settled) {
        settled = true;
        resolve({ cancelled: true, tokens: null });
      }
    });

    Promise.resolve(win.loadURL(targetUrl)).catch((err) => {
      if (!settled && !callbackHandled) {
        // Ignore ERR_ABORTED from closing the window on redirect catch
        if (err && /ERR_ABORTED|-3/i.test(String(err.message || err.code || ""))) {
          return;
        }
        settled = true;
        cleanupRedirectHook();
        closeAllWindows();
        reject(new Error("Could not open Logitech sign-in. Try again."));
      }
    });
  });
}

module.exports = {
  SIGNIN_PARTITION,
  isCallbackUrl,
  isAllowedSignInNavigationUrl,
  runSignInWindow,
};
