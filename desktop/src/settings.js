"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CLIENT_ID = "9d88df5e-7edf-4288-8634-26721cbe7add";
const DEFAULT_PORT = 8080;
const SETTINGS_FILE = "settings.json";
const HUB_AUTH_FILE = "hub-auth.bin";

function normalizeHost(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length > 253) throw new Error("Invalid hub host");
  if (/[\u0000-\u0020\u007f/\\?#@:]/.test(s)) {
    throw new Error("Invalid hub host");
  }
  return s;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PORT;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  return n;
}

function normalizeClientId(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.length > 128 || /[\u0000-\u0020\u007f]/.test(s)) {
    throw new Error("Invalid client_id");
  }
  return s;
}

function basicAuthHeader(username, password) {
  const u = String(username ?? "");
  const p = String(password ?? "");
  if (!u || !p) {
    throw new Error("Username and password are required");
  }
  if (u.includes(":") || /[\r\n\u0000]/.test(u) || /[\r\n\u0000]/.test(p)) {
    throw new Error("Invalid username or password");
  }
  const token = Buffer.from(`${u}:${p}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function writeFileAtomic600(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, data, { mode: 0o600 });
  fs.chmodSync(tmpPath, 0o600);
  fs.renameSync(tmpPath, filePath);
}

function createSettingsStore({ dir, safeStorage = null, env = process.env } = {}) {
  if (!dir || typeof dir !== "string") {
    throw new Error("settings directory is required");
  }
  const settingsPath = path.join(dir, SETTINGS_FILE);
  const hubAuthPath = path.join(dir, HUB_AUTH_FILE);

  function readSettingsFile() {
    try {
      const raw = fs.readFileSync(settingsPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { host: "", port: DEFAULT_PORT, clientId: "" };
      }
      let host = "";
      let port = DEFAULT_PORT;
      let clientId = "";
      try {
        host = normalizeHost(parsed.host);
      } catch {
        host = "";
      }
      try {
        port = normalizePort(parsed.port);
      } catch {
        port = DEFAULT_PORT;
      }
      try {
        clientId = normalizeClientId(parsed.clientId);
      } catch {
        clientId = "";
      }
      return { host, port, clientId };
    } catch {
      return { host: "", port: DEFAULT_PORT, clientId: "" };
    }
  }

  function writeSettingsFile(next) {
    const clean = {
      host: next.host ? normalizeHost(next.host) : "",
      port: normalizePort(next.port),
      clientId: next.clientId ? normalizeClientId(next.clientId) : "",
    };
    writeFileAtomic600(settingsPath, `${JSON.stringify(clean, null, 2)}\n`);
    return clean;
  }

  function isEncryptionAvailable() {
    try {
      return Boolean(
        safeStorage &&
          typeof safeStorage.isEncryptionAvailable === "function" &&
          safeStorage.isEncryptionAvailable() &&
          typeof safeStorage.encryptString === "function" &&
          typeof safeStorage.decryptString === "function"
      );
    } catch {
      return false;
    }
  }

  function getSettings() {
    const current = readSettingsFile();
    const envClientId = String(env?.MELODIOUS_CLIENT_ID ?? "").trim();
    const effectiveClientId = current.clientId || envClientId || DEFAULT_CLIENT_ID;
    return {
      host: current.host,
      port: current.port,
      clientId: current.clientId,
      effectiveClientId,
    };
  }

  function getHub() {
    const { host, port } = readSettingsFile();
    if (!host) return null;
    return { host, port };
  }

  function setHub({ host, port = DEFAULT_PORT }) {
    const cleanHost = normalizeHost(host);
    if (!cleanHost) throw new Error("Hub host is required");
    const cleanPort = normalizePort(port);
    const current = readSettingsFile();
    const saved = writeSettingsFile({
      ...current,
      host: cleanHost,
      port: cleanPort,
    });
    return { host: saved.host, port: saved.port };
  }

  function clearHub() {
    const current = readSettingsFile();
    writeSettingsFile({
      ...current,
      host: "",
      port: DEFAULT_PORT,
    });
    clearHubAuth();
  }

  function setClientId(clientId) {
    const cleanClientId = normalizeClientId(clientId);
    const current = readSettingsFile();
    const saved = writeSettingsFile({
      ...current,
      clientId: cleanClientId,
    });
    return saved.clientId;
  }

  function setHubAuth({ username, password }) {
    const header = basicAuthHeader(username, password);
    if (!isEncryptionAvailable()) {
      try {
        fs.rmSync(hubAuthPath, { force: true });
      } catch {}
      return { stored: false, username: String(username), header: null };
    }
    const payload = JSON.stringify({
      username: String(username),
      header,
    });
    const encrypted = safeStorage.encryptString(payload);
    const buf = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
    writeFileAtomic600(hubAuthPath, buf);
    return { stored: true, username: String(username), header };
  }

  function getHubAuth() {
    if (!isEncryptionAvailable()) return null;
    try {
      if (!fs.existsSync(hubAuthPath)) return null;
      const encrypted = fs.readFileSync(hubAuthPath);
      const decrypted = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.header !== "string" ||
        !parsed.header.startsWith("Basic ") ||
        /[\r\n\u0000]/.test(parsed.header)
      ) {
        return null;
      }
      return {
        username: typeof parsed.username === "string" ? parsed.username : "",
        header: parsed.header,
      };
    } catch {
      return null;
    }
  }

  function getHubAuthHeader() {
    return getHubAuth()?.header ?? null;
  }

  function clearHubAuth() {
    try {
      fs.rmSync(hubAuthPath, { force: true });
    } catch {}
  }

  return {
    getSettings,
    getHub,
    setHub,
    clearHub,
    setClientId,
    isEncryptionAvailable,
    setHubAuth,
    getHubAuth,
    getHubAuthHeader,
    clearHubAuth,
  };
}

module.exports = {
  DEFAULT_CLIENT_ID,
  DEFAULT_PORT,
  normalizeHost,
  normalizePort,
  normalizeClientId,
  basicAuthHeader,
  createSettingsStore,
};
