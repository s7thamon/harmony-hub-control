/* Browser-side IR code library: index search, format detection, and parse
   preview. Fetches run in the browser (hub stays offline). Import still goes
   through POST /api/irdb-import. Parsers align with tools/ir_database_smoke_test.mjs
   and the hub's bulk_import_irdb_commands line shapes. */

import { ENCODABLE, encodeIr } from "./ir-encode.js";
import { LIMITS, parseIrdbLines, prontoToHarmonyRaw, harmonyRawFromTimings, isSafeLabel } from "./views/ir-model.js";

/**
 * Browser-searchable sources only. Flipper-IRDB is intentionally absent:
 * jsDelivr package flat-index returns permanent 403 ("Package size exceeded
 * the configured limit of 50 MB"), and GitHub git/trees is CORS-ok but capped
 * at 60 unauthenticated requests/hour — not a reliable default. Users drop
 * downloaded .ir files instead (parseFlipper still works).
 */
export const LIBRARY_SOURCES = Object.freeze({
  irdb: {
    id: "irdb",
    label: "IRDB (probonopd/irdb)",
    indexUrl: "https://cdn.jsdelivr.net/gh/probonopd/irdb@master/codes/index",
    fileBase: "https://cdn.jsdelivr.net/gh/probonopd/irdb@master/codes/",
  },
});

export const DOC_LINKS = Object.freeze([
  { label: "IRDB codes", href: "https://github.com/probonopd/irdb" },
  {
    label: "Flipper-IRDB (download .ir, drop below)",
    href: "https://github.com/Lucaslhm/Flipper-IRDB",
  },
  { label: "LIRC remotes", href: "https://github.com/probonopd/lirc-remotes" },
]);

/** Verified 2026-08: jsDelivr /flat is dead for these oversized packages. */
export const KNOWN_DEAD_PACKAGE_INDEXES = Object.freeze([
  {
    repo: "Lucaslhm/Flipper-IRDB",
    url: "https://data.jsdelivr.com/v1/package/gh/Lucaslhm/Flipper-IRDB@main/flat",
    status: 403,
    reason: "Package size exceeded the configured limit of 50 MB.",
  },
  {
    repo: "smartHomeHub/SmartIR",
    url: "https://data.jsdelivr.com/v1/package/gh/smartHomeHub/SmartIR@master/flat",
    status: 403,
    reason: "Package size exceeded the configured limit of 50 MB.",
  },
]);

/** NEC-family KeyCode for an IRDB row, or "" when the protocol isn't
    stored as a KeyCode (see ir-encode.js for everything it encodes). */
export function keyFromParts(proto, d, s, f) {
  const encoded = encodeIr(proto, d, s, f);
  return encoded?.mode === "keycode" ? encoded.code : "";
}

const ENCODABLE_RE = new RegExp(`^(?:${ENCODABLE.map((p) => p.replace(/[-]/g, "\\-")).join("|")})$`, "i");

/* A Flipper file's parsed signal as an IRDB-style row. Address and command
   are little-endian hex bytes. */
function flipperParsed(protocol, a, c) {
  const p = String(protocol || "").toUpperCase();
  if (p === "NEC") return encodeIr("NEC1", a[0], -1, c[0]);
  if (p === "NECEXT") return encodeIr("NEC1-f16", a[0], a[1], c[0], c[1]); // 16-bit command: F, then E
  if (p === "SAMSUNG32") return encodeIr("Samsung32", a[0], -1, c[0]);
  if (p === "PIONEER") return encodeIr("Pioneer", a[0], -1, c[0]);
  if (p === "RC5") return encodeIr("RC5", a[0], -1, c[0]);
  if (p === "RC5X") return encodeIr("RC5", a[0], -1, (c[0] & 63) | 64); // extended: command 64-127
  if (p === "RC6") return encodeIr("RC6", a[0], -1, c[0]);
  if (p === "SIRC") return encodeIr("Sony12", a[0], -1, c[0]);
  if (p === "SIRC15") return encodeIr("Sony15", a[0], -1, c[0]);
  if (p === "SIRC20") {
    const address = (a[0] | (a[1] << 8)) & 0x1fff;
    return encodeIr("Sony20", address & 31, address >> 5, c[0]);
  }
  return null;
}

/* Gap appended after a Flipper raw signal that ends on a mark: the hub loops
   a Raw code while a key is held, so it must end with a space. */
const FLIPPER_RAW_GAP_US = 50000;

export function detectFormat(text, filename = "") {
  const t = String(text ?? "");
  const low = String(filename ?? "").toLowerCase();
  if (low.endsWith(".ir") || /^Filetype:\s*IR/im.test(t)) return "flipper";
  if (low.endsWith(".csv") || /^functionname\s*,/im.test(t.trim())) return "irdb-csv";
  if (/begin\s+remote/i.test(t) || low.endsWith(".lirc") || low.endsWith(".lircd") || low.endsWith(".conf")) {
    return "lirc";
  }
  if (/<html|Infrared Hex|Copy to Clipboard/i.test(t)) return "remotecentral";
  if ((t.includes("|") && /\|(raw|keycode)\|/i.test(t)) || /^\s*\S+\|[^\n]+$/m.test(t)) return "pipe";
  if (/(?:0000|0100)\s+[0-9a-fA-F]{4}\s+/i.test(t)) return "pronto";
  if (looksLikeIrdbCsv(t)) return "irdb-csv";
  if (low.endsWith(".json") || /^\s*[\[{]/.test(t.trim())) return "json";
  return "unknown";
}

function csvCells(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function safeName(s) {
  return String(s || "Command").replace(/[|"\r\n\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 96) || "Command";
}

function parseIrdbCsv(text) {
  const rows = [];
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const p = csvCells(trimmed);
    if (!p[0] || /^functionname$/i.test(p[0])) continue;
    const row = irdbCsvRow(p[0], p[1] || "", p[2] || "", p[3] || "", p[4] || "");
    if (row) rows.push(row);
  }
  return rows;
}

function irdbCsvRow(rawName, proto, device, subdevice, fn) {
  const name = safeName(rawName);
  if (!name || /^functionname$/i.test(name)) return null;
  const protocol = String(proto || "");
  const d = String(device || "").trim();
  const sub = String(subdevice === undefined ? "" : subdevice).trim();
  const f = String(fn || "").trim();
  const meta = `${protocol} ${d},${sub},${f}`;
  const encoded = encodeIr(protocol, d, sub, f);
  return encoded
    ? { name, mode: encoded.mode, code: encoded.code, meta, supported: true }
    : { name, mode: "skip", code: "", meta, supported: false };
}

/** Headerless IRDB CSV: any 5-cell row with a known protocol and numeric codes. */
function looksLikeIrdbCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  const head = csvCells(lines[0]).map((cell) => cell.toLowerCase());
  if (
    head.length >= 5 &&
    head[0] === "functionname" &&
    head[1] === "protocol" &&
    head[2] === "device" &&
    head[3] === "subdevice" &&
    head[4] === "function"
  ) {
    return true;
  }
  for (const line of lines) {
    const p = csvCells(line);
    if (p.length < 5) continue;
    const row = irdbCsvRow(p[0], p[1], p[2], p[3], p[4]);
    if (row && row.name && (row.supported || ENCODABLE_RE.test(String(p[1] || "").trim()))) {
      const d = Number(p[2]);
      const f = Number(p[4]);
      const sub = String(p[3] === undefined ? "" : p[3]).trim();
      const subdeviceOk = sub === "" || sub === "-1" || (Number.isFinite(Number(sub)) && Number(sub) >= 0);
      if (Number.isFinite(d) && d >= 0 && Number.isFinite(f) && f >= 0 && subdeviceOk) return true;
    }
  }
  return false;
}

function parseFlipper(text) {
  const out = [];
  let cur = {};
  const push = () => {
    if (!cur.name) {
      cur = {};
      return;
    }
    let keycode = "";
    let raw = "";
    const protocol = cur.protocol || "";
    if (cur.type === "parsed") {
      const a = String(cur.address || "").trim().split(/\s+/).map((x) => parseInt(x, 16) || 0);
      const c = String(cur.command || "").trim().split(/\s+/).map((x) => parseInt(x, 16) || 0);
      const encoded = flipperParsed(protocol, a, c);
      if (encoded?.mode === "keycode") keycode = encoded.code;
      else if (encoded?.mode === "raw") raw = encoded.code;
    } else if (cur.type === "raw") {
      const vals = String(cur.data || "").trim().split(/\s+/).filter(Boolean).map(Number);
      if (vals.length % 2) vals.push(FLIPPER_RAW_GAP_US);
      const freq = Math.max(10000, Math.min(60000, Math.round(Number(cur.frequency) || 38000)));
      if (vals.length >= 4) {
        let r = `F${freq.toString(16).toUpperCase()}`;
        vals.forEach((v, i) => {
          const n = Math.max(1, Math.min(0xfffff, Math.round(Math.abs(v || 0))));
          r += `${i % 2 ? "S" : "P"}${n.toString(16).toUpperCase()}`;
        });
        if (r.length <= LIMITS.rawImport) raw = r;
      }
    }
    out.push({
      name: safeName(cur.name),
      mode: keycode ? "keycode" : raw ? "raw" : "skip",
      code: keycode || raw,
      meta: protocol || cur.type || "flipper",
      supported: Boolean(keycode || raw),
    });
    cur = {};
  };
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t[0] === "#") {
      push();
      continue;
    }
    const i = t.indexOf(":");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k === "name" && cur.name) push();
    cur[k] = cur[k] && k === "data" ? `${cur[k]} ${v}` : v;
  }
  push();
  return out;
}

function parsePronto(text) {
  const re = /((?:0000|0100|5000|6000|7000)(?:\s+[0-9a-fA-F]{4}){10,})/g;
  const rows = [];
  let m;
  let n = 0;
  while ((m = re.exec(String(text)))) {
    n += 1;
    const hex = m[1].replace(/\s+/g, " ").trim();
    const raw = prontoToHarmonyRaw(hex);
    rows.push({
      name: safeName(`Command ${n}`),
      mode: raw ? "raw" : "skip",
      code: raw,
      meta: "Pronto hex",
      supported: Boolean(raw),
    });
  }
  return rows;
}

function parsePipe(text) {
  const { rows } = parseIrdbLines(text);
  return rows.map((r) => {
    let { mode, code } = r;
    if (mode === "irdb") {
      const p = String(code).split(",");
      const encoded = encodeIr(p[0], p[1], p[2], p[3]);
      mode = encoded ? encoded.mode : "skip";
      code = encoded ? encoded.code : "";
    }
    return { name: safeName(r.name), mode, code, meta: r.mode, supported: true };
  }).map((r) => ({
    ...r,
    supported: Boolean(r.code) && r.mode !== "skip",
    mode: r.code ? r.mode : "skip",
  }));
}

/**
 * Parse library text into command rows for preview/import.
 * @returns {{ format: string, rows: Array, supported: number, skipped: number }}
 */
export function parseLibraryText(text, { filename = "", formatHint = "" } = {}) {
  const format = formatHint || detectFormat(text, filename);
  let rows = [];
  if (format === "irdb-csv") rows = parseIrdbCsv(text);
  else if (format === "flipper") rows = parseFlipper(text);
  else if (format === "pipe") rows = parsePipe(text);
  else if (format === "pronto") rows = parsePronto(text);
  else if (format === "unknown" || format === "lirc" || format === "json") {
    /* Best-effort: try pipe/csv/flipper/pronto in order. */
    rows = parseIrdbCsv(text);
    if (!rows.length) rows = parseFlipper(text);
    if (!rows.length) rows = parsePipe(text);
    if (!rows.length) rows = parsePronto(text);
  }
  const supported = rows.filter((r) => r.supported && r.code).length;
  return {
    format,
    rows,
    supported,
    skipped: rows.length - supported,
  };
}

/* IRDB is keyed by brand / category / protocol address, never by model
   (device-db.md §3). The search therefore ranks in that order: brand match
   first, category match second, filename tokens last. Model fragments such
   as "str" or "dg720" only reorder inside the brand+category group; they
   never widen or narrow it. */

function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pathSegments(path) {
  return String(path || "").split(/[/\\]+/).filter(Boolean);
}

/* Split "STR-DG720" into a compact form plus sub-prefixes so a partial
   model in a filename can still score: ["strdg720", "str", "dg720"]. */
function modelKeys(value) {
  const raw = String(value || "").toLowerCase();
  const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const compact = normalizeToken(raw);
  const keys = new Set();
  if (compact) keys.add(compact);
  for (const part of parts) if (part.length >= 2) keys.add(part);
  return [...keys];
}

function brandMatches(pathBrand, manufacturer) {
  const a = normalizeToken(pathBrand);
  const b = normalizeToken(manufacturer);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/* Category aliases between the device form's types and IRDB folders.
   Keys are the normalized (alphanumeric-only) type strings. */
const CATEGORY_KEYS = Object.freeze({
  television: ["tv", "television", "plasma", "monitor", "video projector", "projector"],
  tv: ["tv", "television", "plasma", "monitor"],
  amplifier: ["receiver", "amplifier", "surround processor", "multi-zone receiver", "6 zone receiver", "pre-amplifier", "av receiver"],
  mediaplayer: ["media player", "dvd player", "bluray player", "cd player", "dvr", "streaming"],
  gameconsole: ["game console", "games console"],
  homeappliance: [],
});

/** Score a library path against a structured manufacturer/type/model query. */
export function scoreLibraryPath(path, query) {
  const segments = pathSegments(path);
  const brand = segments[0] || "";
  const category = segments[1] || "";
  const filename = (segments[segments.length - 1] || "").replace(/\.csv$/i, "");

  const isText = typeof query === "string";
  const manufacturer = isText ? query : query?.manufacturer || "";
  const type = isText ? "" : query?.type || "";
  const model = isText ? "" : query?.model || "";

  let score = 0;
  let brandHit = false;
  let categoryHit = false;

  if (String(manufacturer || "").trim()) {
    if (!brandMatches(brand, manufacturer)) return -1;
    brandHit = true;
    score += 100;
  }
  if (String(type || "").trim()) {
    const aliases = CATEGORY_KEYS[normalizeToken(type)] || CATEGORY_KEYS[String(type).toLowerCase()] || [normalizeToken(type)];
    categoryHit = aliases.some((alias) => normalizeToken(category) === normalizeToken(alias));
    if (categoryHit) score += 60;
  }
  const filenameKey = normalizeToken(filename);
  const categoryKey = normalizeToken(category);
  for (const key of modelKeys(model)) {
    if (!key) continue;
    if (filenameKey.includes(key)) score += key.length >= 4 ? 30 : 15;
    else if (categoryKey.includes(key)) score += 5;
  }
  /* Free-text fallback for direct callers: every token must appear
     somewhere in the path (the old any-token match flooded results). */
  if (isText && String(query || "").trim()) {
    const p = segments.join(" ").toLowerCase();
    const tokens = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    if (!tokens.length) return 0;
    for (const t of tokens) {
      if (!p.includes(t)) return -1;
    }
    return tokens.length;
  }
  if (!brandHit && !categoryHit && score <= 0) return -1;
  return score;
}

export function filterLibraryIndex(entries, query, { limit = 40, sourceErrors = [] } = {}) {
  const isText = typeof query === "string";
  const manufacturer = isText ? "" : String(query?.manufacturer || "").trim();
  const type = isText ? "" : String(query?.type || "").trim();
  const model = isText ? "" : String(query?.model || "").trim();
  const textQuery = isText ? String(query || "").trim() : "";
  const incomplete = formatSourceErrors(sourceErrors);
  if ((isText && !textQuery) || (!isText && !manufacturer && !type && !model)) {
    return {
      matches: [],
      totalMatches: 0,
      message: "Enter a manufacturer and model (or either one) to search the code libraries.",
      incomplete,
      sourceErrors: sourceErrors.slice(),
    };
  }
  const scored = [];
  for (const e of entries) {
    const score = scoreLibraryPath(e.path, query);
    if (score < 0) continue;
    scored.push({ ...e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  if (!scored.length) {
    const label = isText ? textQuery : [manufacturer, model].filter(Boolean).join(" ") || type;
    return {
      matches: [],
      totalMatches: 0,
      message:
        `No library files matched “${label}”. Spelling in open databases varies — try fewer words, ` +
        "a different manufacturer spelling, or drop a code file instead." +
        (incomplete ? ` ${incomplete}` : ""),
      incomplete,
      sourceErrors: sourceErrors.slice(),
    };
  }
  const shown = scored.slice(0, limit);
  let message =
    `Showing ${shown.length} of ${scored.length} match${scored.length === 1 ? "" : "es"}.`;
  if (incomplete) message = `${message} ${incomplete}`;
  return {
    matches: shown,
    totalMatches: scored.length,
    message,
    incomplete,
    sourceErrors: sourceErrors.slice(),
  };
}

/** Summarise what a previewed code set actually offers, for ranking rows. */
export function describeCodeSet(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const supportedRows = list.filter((r) => r?.supported && r.code);
  const names = supportedRows.map((r) => normalizeToken(r.name));
  const has = (...needles) => names.some((n) => needles.some((needle) => n.includes(needle)));
  const hasDiscretePower = has("poweron") && has("poweroff");
  const hasTogglePower = has("powertoggle") || (has("power") && !hasDiscretePower);
  const inputs = supportedRows.filter((r) => normalizeToken(r.name).startsWith("input")).length;
  const commands = supportedRows.length;
  let rank = commands;
  if (hasDiscretePower) rank += 1000;
  else if (hasTogglePower) rank += 400;
  rank += Math.min(inputs, 20) * 10;
  const bits = [];
  if (hasDiscretePower) bits.push("discrete power");
  else if (hasTogglePower) bits.push("toggle power");
  if (inputs) bits.push(`${inputs} input${inputs === 1 ? "" : "s"}`);
  bits.push(`${commands} command${commands === 1 ? "" : "s"}`);
  return { commands, inputs, hasDiscretePower, hasTogglePower, rank, label: bits.join(" · ") };
}

/** Human partial-failure copy when some sources load and others do not. */
export function formatSourceErrors(sourceErrors) {
  const list = Array.isArray(sourceErrors) ? sourceErrors.filter(Boolean) : [];
  if (!list.length) return "";
  return (
    `Results are incomplete — failed source${list.length === 1 ? "" : "s"}: ${list.join("; ")}. ` +
    "Matches below cover only the libraries that loaded."
  );
}

/* Allowlist, not sanitiser: index rows are attacker-influenced, so one bad
   segment drops the row. The first char excludes "." (which rejects "." and
   "..") but allows "-", because IRDB really publishes -1,-1.csv sentinels and a
   dash has no traversal meaning. "%", ":", "\", "?", "#", control bytes and
   empty segments stay unspellable — encoded separators, NULs and bad escapes
   cannot get through. */
const IRDB_SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9 ()+,&'!~=@$_.-]*$/;

/**
 * Resolve an IRDB index path against the one approved base.
 * @returns {string} exactly `LIBRARY_SOURCES.irdb.fileBase + path` for a safe
 * relative .csv path, or "" when the path is unsafe or not a code file.
 */
export function irdbFileUrl(path) {
  if (typeof path !== "string" || !path.endsWith(".csv")) return "";
  for (const segment of path.split("/")) {
    if (!IRDB_SAFE_SEGMENT.test(segment)) return "";
  }
  const url = LIBRARY_SOURCES.irdb.fileBase + path;
  /* Belt and braces: whatever the allowlist passed must still normalise back
     under the exact /codes/ prefix. */
  try {
    if (!new URL(url).href.startsWith(LIBRARY_SOURCES.irdb.fileBase)) return "";
  } catch {
    return "";
  }
  return url;
}

let cachedIndex = null;

/**
 * Load searchable indexes. `skipped` counts index rows refused by the path
 * boundary — an index note, not a source failure, so it stays out of `errors`.
 * @returns {Promise<{ entries: object[], errors: string[], loaded: string[], skipped: number }>}
 */
export async function loadLibraryIndex({ sources = ["irdb"], fetchImpl = fetch } = {}) {
  const wanted = (sources || []).filter((s) => s === "irdb");
  const key = wanted.slice().sort().join(",") || "none";
  if (cachedIndex && cachedIndex.key === key) {
    return {
      entries: cachedIndex.entries,
      errors: cachedIndex.errors.slice(),
      loaded: cachedIndex.loaded.slice(),
      skipped: cachedIndex.skipped,
    };
  }

  const entries = [];
  const errors = [];
  const loaded = [];
  let skipped = 0;

  if (wanted.includes("irdb")) {
    try {
      const r = await fetchImpl(LIBRARY_SOURCES.irdb.indexUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      let n = 0;
      for (const line of text.replace(/\r/g, "").split("\n")) {
        const path = line.trim();
        if (!path) continue;
        const url = irdbFileUrl(path);
        if (!url) {
          skipped += 1;
          continue;
        }
        entries.push({ source: "irdb", path, url });
        n += 1;
      }
      if (!n) {
        throw new Error(
          skipped
            ? `no usable code files in the index (${skipped} skipped by the path safety check)`
            : "index was empty",
        );
      }
      loaded.push("irdb");
    } catch (e) {
      errors.push(`IRDB: ${e.message || e}`);
    }
  }

  /* Reject unknown/removed sources so callers cannot silently enable Flipper. */
  for (const s of sources || []) {
    if (s && s !== "irdb") {
      errors.push(
        `${s}: browser search is not available for this library (use a downloaded file instead)`,
      );
    }
  }

  if (!entries.length) {
    throw new Error(
      errors.length
        ? `Could not load code libraries (${errors.join("; ")}). Check network access from this browser.`
        : "No library sources selected.",
    );
  }

  cachedIndex = { key, entries, errors: errors.slice(), loaded: loaded.slice(), skipped };
  return { entries, errors, loaded, skipped };
}

/** Fetch a library file, from the approved IRDB base only — never from a URL
    the entry carries, which a forged index row could have chosen. */
export async function fetchLibraryFile(entry, { fetchImpl = fetch } = {}) {
  if (entry?.source !== "irdb") {
    throw new Error("Refusing to fetch: only IRDB entries can be fetched from the browser.");
  }
  const path = typeof entry.path === "string" ? entry.path : "";
  if (!path) throw new Error("Refusing to fetch: library entry has no path.");
  const url = irdbFileUrl(path);
  if (!url) throw new Error(`Refusing to fetch unsafe library path: ${safeName(path)}`);
  if (entry.url !== undefined && entry.url !== url) {
    throw new Error(`Refusing to fetch: entry URL does not match its path (${safeName(path)}).`);
  }
  const r = await fetchImpl(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed HTTP ${r.status} for ${path}`);
  return r.text();
}

/**
 * Account for every row: found → supported → importable (safe name) → willImport.
 * Callers must show these numbers so preview and post-import inventory reconcile.
 */
export function planImport(rows, existingCount = 0) {
  const list = Array.isArray(rows) ? rows : [];
  const found = list.length;
  let unsupported = 0;
  let unsafeName = 0;
  const importableRows = [];
  for (const row of list) {
    if (!row?.supported || !row.code) {
      unsupported += 1;
      continue;
    }
    if (!isSafeLabel(row.name, LIMITS.name)) {
      unsafeName += 1;
      continue;
    }
    importableRows.push(row);
  }
  const supported = found - unsupported;
  const importable = importableRows.length;
  const room = Math.max(0, LIMITS.storedCommands - (Number(existingCount) || 0));
  const batchCap = LIMITS.batchCommands;
  const willImport = Math.min(importable, room, batchCap);
  const truncated = Math.max(0, importable - willImport);
  const notes = [];
  notes.push(
    `${found} found · ${supported} supported · ${unsupported} unsupported` +
      (unsafeName ? ` · ${unsafeName} unsafe name${unsafeName === 1 ? "" : "s"}` : "") +
      ` · ${willImport} will import` +
      (truncated ? ` · ${truncated} held back by hub limits` : "") +
      ".",
  );
  notes.push(`Hub keeps at most ${LIMITS.storedCommands} commands per device (${room} free on this one).`);
  notes.push(`One import request stages at most ${batchCap} commands.`);
  if (truncated) {
    notes.push(
      `Only the first ${willImport} of ${importable} importable command${importable === 1 ? "" : "s"} fit this request.`,
    );
  }
  return {
    found,
    supported,
    unsupported,
    unsafeName,
    importable,
    willImport,
    truncated,
    room,
    batchCap,
    notes,
    summary: notes[0],
  };
}

/** @deprecated use planImport — kept for call sites that only need caps. */
export function describeImportLimits(existingCount, importCount) {
  const plan = planImport(
    Array.from({ length: importCount }, (_, i) => ({
      name: `Cmd${i}`,
      code: "x",
      supported: true,
    })),
    existingCount,
  );
  return {
    room: plan.room,
    batchCap: plan.batchCap,
    willImport: plan.willImport,
    notes: plan.notes.slice(1),
  };
}

/** Build pipe payload lines the hub's /api/irdb-import accepts. */
export function rowsToImportPayload(rows, { max = LIMITS.batchCommands } = {}) {
  const lines = [];
  for (const row of rows) {
    if (!row?.supported || !row.code) continue;
    if (!isSafeLabel(row.name, LIMITS.name)) continue;
    if (row.mode === "raw") lines.push(`${row.name}|raw|${row.code}`);
    else lines.push(`${row.name}|keycode|${row.code}`);
    if (lines.length >= max) break;
  }
  return lines.join("\n");
}

/** Clear cached indexes (tests). */
export function resetLibraryCache() {
  cachedIndex = null;
}
