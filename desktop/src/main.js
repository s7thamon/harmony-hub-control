"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  session,
  shell,
} = require("electron");
const {
  DEFAULT_CLIENT_ID,
  basicAuthHeader,
  createSettingsStore,
  normalizeHost,
  normalizePort,
} = require("./settings");
const { discoverHubs, probeHub } = require("./discovery");
const { createSchemeHandler } = require("./scheme");
const {
  attachSessionSecurity,
  attachWindowSecurity,
  isTrustedIpcSender,
} = require("./security");
const { createCatalogService } = require("./catalog/client");
const { runSignInWindow } = require("./catalog/signin-window");
const { registerCatalogIpcHandlers } = require("./ipc");

// Test hooks (stand-in safeStorage, stub catalog) exist only when running from
// source; a packaged app ignores MELODIOUS_E2E.
const E2E = process.env.MELODIOUS_E2E === "1" && !app.isPackaged;

if (process.env.MELODIOUS_USER_DATA_DIR) {
  app.setPath("userData", process.env.MELODIOUS_USER_DATA_DIR);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "melodious",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createE2eSafeStorage() {
  const key = crypto
    .createHash("sha256")
    .update("melodious-e2e-safe-storage-key")
    .digest();
  return {
    isEncryptionAvailable() {
      return process.env.MELODIOUS_E2E_NO_SAFESTORAGE !== "1";
    },
    encryptString(plainText) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([
        cipher.update(String(plainText), "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, enc]);
    },
    decryptString(buffer) {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
        "utf8"
      );
    },
  };
}

let mainWindow = null;
let settingsStore = null;
let catalogService = null;
let pageMode = "connect";
let lastUnreachableError = null;

function getActiveCatalogService() {
  return (E2E && globalThis.__melodiousCatalogService) || catalogService;
}

function openSettingsPage() {
  pageMode = "settings";
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => openSettingsPage(),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Developer Tools",
          accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          },
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function registerIpcHandlers() {
  const checkSender = (event) => {
    if (!isTrustedIpcSender(event, mainWindow)) {
      throw new Error("Untrusted IPC sender");
    }
  };

  ipcMain.handle("desktop:get-state", async (event) => {
    checkSender(event);
    const hub = settingsStore.getHub();
    const hubAuth = settingsStore.getHubAuth();
    const settings = settingsStore.getSettings();
    const catSvc = getActiveCatalogService();
    const catStatus = catSvc ? await catSvc.status() : { signedIn: false };
    return {
      mode: pageMode,
      hub,
      hasHubAuth: Boolean(hubAuth?.header),
      hubUsername: hubAuth?.username || "",
      logitechSignedIn: Boolean(catStatus?.signedIn),
      encryptionAvailable: settingsStore.isEncryptionAvailable(),
      clientId: settings.clientId,
      defaultClientId: DEFAULT_CLIENT_ID,
      unreachableError: lastUnreachableError,
    };
  });

  ipcMain.handle("desktop:discover-hubs", async (event) => {
    checkSender(event);
    return discoverHubs({
      authHeader: settingsStore.getHubAuthHeader(),
    });
  });

  ipcMain.handle("desktop:connect-hub", async (event, args = {}) => {
    checkSender(event);
    let host;
    let port;
    try {
      host = normalizeHost(args.host);
      port = normalizePort(args.port);
    } catch (err) {
      return {
        ok: false,
        authRequired: false,
        error: err?.message || "Invalid hub address.",
      };
    }
    if (!host) {
      return {
        ok: false,
        authRequired: false,
        error: "Enter your hub's IP address or hostname.",
      };
    }

    const username = String(args.username ?? "").trim();
    const password = String(args.password ?? "");
    let authHeader = null;
    if (username || password) {
      try {
        authHeader = basicAuthHeader(username, password);
      } catch (err) {
        return {
          ok: false,
          authRequired: true,
          error: err?.message || "Invalid username or password.",
        };
      }
    } else {
      const currentHub = settingsStore.getHub();
      if (currentHub && currentHub.host === host && currentHub.port === port) {
        authHeader = settingsStore.getHubAuthHeader();
      }
    }

    const probed = await probeHub({ host, port, authHeader });
    if (!probed) {
      return {
        ok: false,
        authRequired: false,
        error: `Can't reach a Melodious hub at ${host}:${port}.`,
      };
    }
    if (probed.authRequired) {
      return {
        ok: false,
        authRequired: true,
        host,
        port,
        error:
          username || password
            ? "The hub rejected that username or password."
            : "This hub requires a username and password.",
      };
    }

    settingsStore.setHub({ host, port });
    if (username && password) {
      settingsStore.setHubAuth({ username, password });
    }
    lastUnreachableError = null;
    pageMode = "shell";
    return {
      ok: true,
      connected: true,
      hub: { host, port },
      firmware: probed.firmware,
    };
  });

  ipcMain.handle("desktop:save-hub-auth", (event, args = {}) => {
    checkSender(event);
    try {
      const res = settingsStore.setHubAuth({
        username: args.username,
        password: args.password,
      });
      return { ok: true, stored: res.stored };
    } catch (err) {
      return { ok: false, error: err?.message || "Invalid username or password." };
    }
  });

  ipcMain.handle("desktop:clear-hub-auth", (event) => {
    checkSender(event);
    settingsStore.clearHubAuth();
    return { ok: true };
  });

  ipcMain.handle("desktop:forget-hub", (event) => {
    checkSender(event);
    settingsStore.clearHub();
    lastUnreachableError = null;
    pageMode = "connect";
    return { ok: true };
  });

  ipcMain.handle("desktop:save-client-id", async (event, args = {}) => {
    checkSender(event);
    try {
      const before = settingsStore.getSettings().effectiveClientId;
      const clientId = settingsStore.setClientId(args.clientId);
      if (before !== settingsStore.getSettings().effectiveClientId) await getActiveCatalogService().signOut();
      return { ok: true, clientId };
    } catch (err) {
      return { ok: false, error: err?.message || "Invalid client_id." };
    }
  });

  ipcMain.handle("desktop:open-shell", (event) => {
    checkSender(event);
    if (settingsStore.getHub()) {
      pageMode = "shell";
    }
    return { ok: true, mode: pageMode };
  });

  ipcMain.handle("desktop:open-connect", (event) => {
    checkSender(event);
    pageMode = "connect";
    return { ok: true, mode: pageMode };
  });

  ipcMain.handle("desktop:open-settings", (event) => {
    checkSender(event);
    pageMode = "settings";
    return { ok: true, mode: pageMode };
  });

  registerCatalogIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    getCatalogService: () => getActiveCatalogService(),
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: "#0e1014",
    title: "Melodious",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  attachWindowSecurity({
    win: mainWindow,
    openExternal: (url) =>
      E2E && typeof globalThis.__melodiousOpenExternal === "function"
        ? globalThis.__melodiousOpenExternal(url)
        : shell.openExternal(url),
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL("melodious://app/");
  return mainWindow;
}

app.whenReady().then(() => {
  app.name = "Melodious";
  const storageBackend = E2E ? createE2eSafeStorage() : safeStorage;

  settingsStore = createSettingsStore({
    dir: app.getPath("userData"),
    safeStorage: storageBackend,
  });

  catalogService = createCatalogService({
    settingsStore,
    openSignInWindow: ({ client, clientId }) =>
      runSignInWindow({
        client,
        clientId,
        parentWindow: mainWindow,
      }),
  });

  if (process.env.MELODIOUS_INITIAL_HOST) {
    settingsStore.setHub({
      host: process.env.MELODIOUS_INITIAL_HOST,
      port: Number(process.env.MELODIOUS_INITIAL_PORT || 8080),
    });
  }

  pageMode = settingsStore.getHub() ? "shell" : "connect";

  const shellDir = path.join(__dirname, "..", "build", "shell");
  const connectDir = path.join(__dirname, "connect");

  const schemeHandler = createSchemeHandler({
    shellDir,
    connectDir,
    getHub: () => settingsStore.getHub(),
    getSavedAuthHeader: () => settingsStore.getHubAuthHeader(),
    getPageMode: () => pageMode,
    onHubAuthRequired: (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop:hub-auth-required", info);
      }
    },
    onHubUnreachable: (info) => {
      lastUnreachableError = "Can't reach the hub";
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop:hub-unreachable", info);
      }
    },
  });

  protocol.handle("melodious", (req) => schemeHandler.handle(req));

  attachSessionSecurity({
    ses: session.defaultSession,
    getMainWindow: () => mainWindow,
    showSaveDialog: (win, opts) =>
      E2E && typeof globalThis.__melodiousShowSaveDialog === "function"
        ? globalThis.__melodiousShowSaveDialog(win, opts)
        : dialog.showSaveDialogSync(win, opts),
  });

  registerIpcHandlers();
  Menu.setApplicationMenu(buildAppMenu());
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || E2E) {
    app.quit();
  }
});
