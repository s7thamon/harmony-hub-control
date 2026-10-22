"use strict";

const dgram = require("node:dgram");
const http = require("node:http");
const { normalizeHost, normalizePort } = require("./settings");

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_ST = "urn:myharmony-com:device:harmony:1";

const SSDP_MSEARCH_PAYLOAD = [
  "M-SEARCH * HTTP/1.1",
  `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  "MX: 2",
  `ST: ${SSDP_ST}`,
  "",
  "",
].join("\r\n");

function parseSsdpHeaders(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const statusLine = (lines[0] || "").trim();
  const headers = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[key] = value;
  }
  return { statusLine, headers };
}

function parseSsdpResponse(message, rinfo = {}) {
  const text = Buffer.isBuffer(message)
    ? message.toString("utf8")
    : String(message ?? "");
  if (!text.trim()) return null;

  const { statusLine, headers } = parseSsdpHeaders(text);
  if (!/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
    return null;
  }

  const lower = text.toLowerCase();
  const isHarmony =
    lower.includes("myharmony") ||
    lower.includes("harmony") ||
    lower.includes(":8088");
  if (!isHarmony) {
    return null;
  }

  let rawHost = String(rinfo?.address ?? "").trim();
  if (!rawHost && headers.location) {
    try {
      rawHost = new URL(headers.location).hostname;
    } catch {
      rawHost = "";
    }
  }
  let host = "";
  try {
    host = normalizeHost(rawHost);
  } catch {
    return null;
  }
  if (!host) return null;

  return {
    name: `Hub (${host})`,
    host,
    webUiPort: 8080,
    hbusPort: 8088,
    location: headers.location || "",
    st: headers.st || "",
    usn: headers.usn || "",
  };
}

function probeHub({
  host,
  port = 8080,
  authHeader = null,
  timeoutMs = 2000,
  requestImpl = http.request,
} = {}) {
  return new Promise((resolve) => {
    let cleanHost;
    let cleanPort;
    try {
      cleanHost = normalizeHost(host);
      cleanPort = normalizePort(port);
    } catch {
      resolve(null);
      return;
    }
    if (!cleanHost) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const headers = { Accept: "application/json" };
    if (authHeader && typeof authHeader === "string" && !/[\r\n\u0000]/.test(authHeader)) {
      headers.Authorization = authHeader;
    }

    const req = requestImpl(
      {
        host: cleanHost,
        port: cleanPort,
        path: "/api/system-status",
        method: "GET",
        headers,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status !== 200 && status !== 401) {
          res.resume();
          finish(null);
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes <= 65536) chunks.push(chunk);
        });
        res.on("end", () => {
          if (status === 401) {
            finish({
              name: `Hub (${cleanHost})`,
              host: cleanHost,
              port: cleanPort,
              webUiPort: cleanPort,
              hbusPort: 8088,
              firmware: "",
              authRequired: true,
              isSimulated: false,
            });
            return;
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          const firmware =
            parsed && typeof parsed.firmware === "string" ? parsed.firmware.trim() : "";
          const uname =
            parsed && typeof parsed.uname === "string" ? parsed.uname : "";
          const isSimulated =
            uname.toLowerCase().includes("sim") || cleanPort === 8787;
          finish({
            name: `Hub (${cleanHost})`,
            host: cleanHost,
            port: cleanPort,
            webUiPort: cleanPort,
            hbusPort: 8088,
            firmware,
            authRequired: false,
            isSimulated,
          });
        });
        res.on("error", () => finish(null));
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, timeoutMs);

    req.on("error", () => finish(null));
    req.end();
  });
}

function scanSsdp({
  timeoutMs = 1500,
  createSocket = () => dgram.createSocket("udp4"),
} = {}) {
  return new Promise((resolve) => {
    const discovered = new Map();
    let socket;
    try {
      socket = createSocket();
    } catch {
      resolve([]);
      return;
    }

    let closed = false;
    const closeSocket = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve([...discovered.values()]);
    };

    const timer = setTimeout(closeSocket, timeoutMs);

    socket.on("error", () => {
      closeSocket();
    });

    socket.on("message", (msg, rinfo) => {
      const parsed = parseSsdpResponse(msg, rinfo);
      if (parsed && !discovered.has(parsed.host)) {
        discovered.set(parsed.host, parsed);
      }
    });

    try {
      socket.bind(0, () => {
        try {
          if (typeof socket.setBroadcast === "function") {
            socket.setBroadcast(true);
          }
        } catch {}
        const buf = Buffer.from(SSDP_MSEARCH_PAYLOAD, "utf8");
        try {
          socket.send(buf, 0, buf.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
            if (err) closeSocket();
          });
        } catch {
          closeSocket();
        }
      });
    } catch {
      closeSocket();
    }
  });
}

async function discoverHubs({
  timeoutMs = 1500,
  probeTimeoutMs = 2000,
  authHeader = null,
  createSocket,
  requestImpl,
} = {}) {
  const candidates = await scanSsdp({ timeoutMs, createSocket });
  const results = await Promise.all(
    candidates.map((candidate) =>
      probeHub({
        host: candidate.host,
        port: candidate.webUiPort || 8080,
        authHeader,
        timeoutMs: probeTimeoutMs,
        requestImpl,
      })
    )
  );
  return results.filter(Boolean);
}

module.exports = {
  SSDP_ADDRESS,
  SSDP_PORT,
  SSDP_ST,
  SSDP_MSEARCH_PAYLOAD,
  parseSsdpHeaders,
  parseSsdpResponse,
  probeHub,
  scanSsdp,
  discoverHubs,
};
