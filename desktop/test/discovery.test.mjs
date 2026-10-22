import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SSDP_ADDRESS,
  SSDP_PORT,
  SSDP_ST,
  SSDP_MSEARCH_PAYLOAD,
  parseSsdpResponse,
  probeHub,
  scanSsdp,
  discoverHubs,
} = require("../src/discovery.js");

test("SSDP M-SEARCH payload matches HubDiscovery.kt", () => {
  assert.equal(SSDP_ADDRESS, "239.255.255.250");
  assert.equal(SSDP_PORT, 1900);
  assert.equal(SSDP_ST, "urn:myharmony-com:device:harmony:1");
  assert.ok(SSDP_MSEARCH_PAYLOAD.startsWith("M-SEARCH * HTTP/1.1\r\n"));
  assert.ok(SSDP_MSEARCH_PAYLOAD.includes("HOST: 239.255.255.250:1900\r\n"));
  assert.ok(SSDP_MSEARCH_PAYLOAD.includes('MAN: "ssdp:discover"\r\n'));
  assert.ok(SSDP_MSEARCH_PAYLOAD.includes("MX: 2\r\n"));
  assert.ok(
    SSDP_MSEARCH_PAYLOAD.includes("ST: urn:myharmony-com:device:harmony:1\r\n\r\n")
  );
});

test("parseSsdpResponse accepts Harmony responses and rejects unrelated packets", () => {
  const validPacket = [
    "HTTP/1.1 200 OK",
    "CACHE-CONTROL: max-age=1800",
    "EXT:",
    "LOCATION: http://10.0.0.42:8088/description.xml",
    "SERVER: Linux/2.6.31 UPnP/1.0 Harmony/4.15.600",
    "ST: urn:myharmony-com:device:harmony:1",
    "USN: uuid:1234::urn:myharmony-com:device:harmony:1",
    "",
    "",
  ].join("\r\n");

  const parsed = parseSsdpResponse(validPacket, { address: "10.0.0.42" });
  assert.deepEqual(parsed, {
    name: "Hub (10.0.0.42)",
    host: "10.0.0.42",
    webUiPort: 8080,
    hbusPort: 8088,
    location: "http://10.0.0.42:8088/description.xml",
    st: "urn:myharmony-com:device:harmony:1",
    usn: "uuid:1234::urn:myharmony-com:device:harmony:1",
  });

  // Non-Harmony UPnP device is ignored
  const otherUpnp = [
    "HTTP/1.1 200 OK",
    "LOCATION: http://10.0.0.99:1400/xml/device_description.xml",
    "ST: urn:schemas-upnp-org:device:ZonePlayer:1",
    "",
    "",
  ].join("\r\n");
  assert.equal(parseSsdpResponse(otherUpnp, { address: "10.0.0.99" }), null);

  // Non-200 status is ignored
  assert.equal(
    parseSsdpResponse("M-SEARCH * HTTP/1.1\r\nST: urn:myharmony-com:device:harmony:1\r\n\r\n", {
      address: "10.0.0.42",
    }),
    null
  );
});

test("probeHub treats 200 and 401 on /api/system-status as Melodious hubs", async () => {
  let mode = "200";
  const server = http.createServer((req, res) => {
    if (req.url !== "/api/system-status") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (mode === "200") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, firmware: "4.15.600", uname: "Linux HarmonyHub" }));
    } else if (mode === "401") {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Harmony Hub Control"' });
      res.end(JSON.stringify({ ok: false, error: "authentication required" }));
    } else {
      res.writeHead(500);
      res.end("error");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const okHub = await probeHub({ host: "127.0.0.1", port });
    assert.equal(okHub.host, "127.0.0.1");
    assert.equal(okHub.port, port);
    assert.equal(okHub.firmware, "4.15.600");
    assert.equal(okHub.authRequired, false);

    mode = "401";
    const authHub = await probeHub({ host: "127.0.0.1", port });
    assert.equal(authHub.host, "127.0.0.1");
    assert.equal(authHub.port, port);
    assert.equal(authHub.authRequired, true);

    mode = "500";
    const badHub = await probeHub({ host: "127.0.0.1", port });
    assert.equal(badHub, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("scanSsdp and discoverHubs deduplicate responders and probe /api/system-status", async () => {
  function createFakeSocket() {
    const emitter = new EventEmitter();
    emitter.bind = (_port, cb) => setImmediate(cb);
    emitter.setBroadcast = () => {};
    emitter.send = (_buf, _offset, _len, _port, _addr, cb) => {
      cb?.(null);
      setImmediate(() => {
        const pkt =
          "HTTP/1.1 200 OK\r\nST: urn:myharmony-com:device:harmony:1\r\n\r\n";
        emitter.emit("message", Buffer.from(pkt), { address: "10.0.0.21" });
        emitter.emit("message", Buffer.from(pkt), { address: "10.0.0.21" });
        emitter.emit("message", Buffer.from(pkt), { address: "10.0.0.22" });
      });
    };
    emitter.close = () => {};
    return emitter;
  }

  const scanned = await scanSsdp({ timeoutMs: 40, createSocket: createFakeSocket });
  assert.equal(scanned.length, 2);
  assert.deepEqual(
    scanned.map((h) => h.host),
    ["10.0.0.21", "10.0.0.22"]
  );

  // discoverHubs probes each candidate and keeps only 200/401 responders
  const hubs = await discoverHubs({
    timeoutMs: 40,
    createSocket: createFakeSocket,
    requestImpl: (opts, cb) => {
      const req = new EventEmitter();
      req.end = () => {
        setImmediate(() => {
          const res = new EventEmitter();
          res.statusCode = opts.host === "10.0.0.21" ? 200 : 404;
          res.resume = () => {};
          cb(res);
          if (res.statusCode === 200) {
            res.emit("data", Buffer.from(JSON.stringify({ firmware: "4.15.600" })));
            res.emit("end");
          }
        });
      };
      req.destroy = () => {};
      return req;
    },
  });

  assert.equal(hubs.length, 1);
  assert.equal(hubs[0].host, "10.0.0.21");
  assert.equal(hubs[0].firmware, "4.15.600");
});
