"use strict";

const crypto = require("node:crypto");
const { DEFAULT_CLIENT_ID } = require("../settings");

const OAUTH_AUTHORIZE_URL = "https://accounts.logi.com/identity/oauth2/authorize";
const OAUTH_TOKEN_URL = "https://accounts.logi.com/identity/oauth2/token";
const OAUTH_REDIRECT_URI = "com.logitech.harmony://lidsoauth";
const OAUTH_SCHEME = "com.logitech.harmony:";

class CatalogError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogError";
  }
}

function base64url(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pkcePair() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier, "ascii").digest()
  );
  const state = base64url(crypto.randomBytes(24));
  return { verifier, challenge, state };
}

function authorizeUrl({ clientId = DEFAULT_CLIENT_ID, challenge, state } = {}) {
  const cid = String(clientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  if (!challenge || !state) {
    throw new CatalogError("PKCE challenge and state are required");
  }
  const params = new URLSearchParams({
    client_id: cid,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: String(challenge),
    state: String(state),
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: "openid",
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

function parseCallback(text, { expectedState } = {}) {
  const candidate = String(text ?? "").trim();
  if (!candidate) {
    throw new CatalogError(
      "nothing was pasted; paste the callback address from your browser"
    );
  }

  let scheme = "";
  let host = "";
  let query = candidate;

  if (candidate.includes("://")) {
    try {
      const parsed = new URL(candidate);
      scheme = parsed.protocol.toLowerCase();
      host = (parsed.hostname || parsed.host || "").toLowerCase();
      query = parsed.search.startsWith("?")
        ? parsed.search.slice(1)
        : parsed.search;
    } catch {
      throw new CatalogError(
        "that is not the callback address: it should start with com.logitech.harmony://lidsoauth and carry code= and state="
      );
    }
  } else if (candidate.startsWith("?")) {
    query = candidate.slice(1);
  }

  if (
    host.endsWith("logi.com") ||
    candidate.toLowerCase().startsWith("id.logi.com/") ||
    candidate.toLowerCase().startsWith("accounts.logi.com/")
  ) {
    throw new CatalogError(
      "that is Logitech's own page, not the callback. It hands your browser a com.logitech.harmony://lidsoauth?code=... address"
    );
  }

  if (scheme && scheme !== OAUTH_SCHEME) {
    throw new CatalogError(
      "that is not the callback address: it should start with com.logitech.harmony://lidsoauth and carry code= and state="
    );
  }

  if (scheme) {
    const u = new URL(candidate);
    if (u.host !== "lidsoauth" || u.pathname || u.hash || u.username || u.password) {
      throw new CatalogError("Invalid Logitech callback address");
    }
  }

  const params = new URLSearchParams(query);
  if (params.has("error")) {
    throw new CatalogError("Logitech refused the sign-in; sign in again");
  }

  const code = (params.get("code") || "").trim();
  const state = (params.get("state") || "").trim();
  if (!code) {
    throw new CatalogError(
      "that is not the callback address: it should start with com.logitech.harmony://lidsoauth and carry code= and state="
    );
  }
  if (!state || !expectedState || state !== expectedState || params.getAll("state").length !== 1 || params.getAll("code").length !== 1) {
    throw new CatalogError(
      "that callback belongs to a different sign-in attempt; sign in again from the tab this run opened"
    );
  }
  return code;
}

function buildExchangeForm({ clientId = DEFAULT_CLIENT_ID, code, verifier } = {}) {
  const cid = String(clientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  return {
    grant_type: "authorization_code",
    client_id: cid,
    code_verifier: String(verifier ?? ""),
    redirect_uri: OAUTH_REDIRECT_URI,
    code: String(code ?? ""),
  };
}

function buildRefreshForm({ clientId = DEFAULT_CLIENT_ID, refreshToken } = {}) {
  const cid = String(clientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  return {
    grant_type: "refresh_token",
    client_id: cid,
    refresh_token: String(refreshToken ?? ""),
  };
}

function parseTokens(value, fallback = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError("the sign-in answer was not a JSON object");
  }
  const accessToken = value.access_token;
  const idToken =
    typeof value.id_token === "string" && value.id_token
      ? value.id_token
      : fallback?.id_token;
  const refreshToken =
    typeof value.refresh_token === "string" && value.refresh_token
      ? value.refresh_token
      : fallback?.refresh_token;

  if (typeof accessToken !== "string" || !accessToken || typeof idToken !== "string" || !idToken) {
    throw new CatalogError("access_token or id_token is missing from the sign-in answer");
  }
  const out = {
    access_token: accessToken,
    id_token: idToken,
  };
  if (typeof refreshToken === "string" && refreshToken) {
    out.refresh_token = refreshToken;
  }
  return out;
}

function rejectedMessage(what, status) {
  const hint =
    status === 401 || status === 403
      ? " -- the saved sign-in may have expired; sign in again"
      : "";
  return `${what}: HTTP ${status}${hint}`;
}

async function oauthExchange(client, { clientId = DEFAULT_CLIENT_ID, code, verifier } = {}) {
  const fields = buildExchangeForm({ clientId, code, verifier });
  const { status, payload } = await client.postForm(OAUTH_TOKEN_URL, fields);
  if (status !== 200) {
    throw new CatalogError(
      `Logitech rejected the code exchange: HTTP ${status}; codes work once and expire within minutes, so sign in afresh`
    );
  }
  return parseTokens(payload);
}

async function oauthRefresh(client, tokens, clientId = DEFAULT_CLIENT_ID) {
  if (!tokens || typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
    throw new CatalogError("there is no refresh_token; a browser sign-in is needed");
  }
  const fields = buildRefreshForm({
    clientId,
    refreshToken: tokens.refresh_token,
  });
  const { status, payload } = await client.postForm(OAUTH_TOKEN_URL, fields);
  if (status !== 200) {
    throw new CatalogError(rejectedMessage("Logitech rejected the renewal", status));
  }
  return parseTokens(payload, tokens);
}

module.exports = {
  OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL,
  OAUTH_REDIRECT_URI,
  OAUTH_SCHEME,
  DEFAULT_CLIENT_ID,
  CatalogError,
  base64url,
  pkcePair,
  authorizeUrl,
  parseCallback,
  buildExchangeForm,
  buildRefreshForm,
  parseTokens,
  oauthExchange,
  oauthRefresh,
};
