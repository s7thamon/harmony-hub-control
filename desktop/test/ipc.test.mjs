import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CATALOG_CHANNELS,
  validateCatalogString,
  validateCatalogId,
  createCatalogIpcHandlers,
} = require("../src/ipc.js");

function makeTrustedEvent(win) {
  return {
    sender: win.webContents,
    senderFrame: win.webContents.mainFrame,
  };
}

function makeFakeMainWindow(url = "melodious://app/#devices/1") {
  const mainFrame = { url };
  const webContents = {
    mainFrame,
    getURL: () => url,
  };
  return {
    isDestroyed: () => false,
    webContents,
  };
}

test("IPC argument validators enforce trimmed 1-64 char strings and positive integer ids", () => {
  assert.equal(validateCatalogString("  Sony  ", "manufacturer"), "Sony");
  assert.equal(validateCatalogId(167856), 167856);

  for (const badStr of [
    "",
    "   ",
    "x".repeat(65),
    "Sony\n",
    "Sony\u0000",
    123,
    null,
    undefined,
    {},
    [],
  ]) {
    assert.throws(
      () => validateCatalogString(badStr, "manufacturer"),
      /Invalid manufacturer/
    );
  }

  for (const badId of [0, -1, 1.5, NaN, Infinity, "167856", null, undefined, {}, true]) {
    assert.throws(() => validateCatalogId(badId), /Invalid catalog device id/);
  }
});

test("catalog:* IPC handlers enforce sender check, argument checks, secret redaction, and plain error messages", async () => {
  const mainWin = makeFakeMainWindow("melodious://app/#devices/1");
  const trustedEvent = makeTrustedEvent(mainWin);

  const fakeService = {
    async status() {
      return {
        signedIn: true,
        access_token: "MUST_NOT_LEAK",
        AccountId: "MUST_NOT_LEAK",
      };
    },
    async signIn() {
      return {
        signedIn: true,
        refresh_token: "MUST_NOT_LEAK",
      };
    },
    async signOut() {
      return { signedIn: false };
    },
    async checkModel({ manufacturer, model }) {
      return {
        found: true,
        manufacturer,
        model: `${model}20`,
        Cookie: "MUST_NOT_LEAK",
      };
    },
    async search({ manufacturer, model }) {
      if (model === "NONE") {
        throw new Error(`No catalog device matches ${manufacturer} ${model}`);
      }
      return [
        {
          id: 167856,
          manufacturer,
          model: "STR-DG720",
          displayText: "Sony STR-DG720",
          deviceType: "Receiver",
          description: "AV Receiver",
          access_token: "MUST_NOT_LEAK",
          AccountId: "MUST_NOT_LEAK",
        },
      ];
    },
    async download({ id, manufacturer, model }) {
      return {
        schema_version: "0.2.0",
        source: "logitech-catalog-via-melodious-desktop",
        query: { manufacturer, model },
        resources: {
          selected_match: { "Id-": id, AccountId: "MUST_NOT_LEAK" },
          global_language_commands: [
            {
              Name: "PowerOn",
              KeyCode: "G:Sony 15 Bit:()(0x3A0C)():3",
              access_token: "MUST_NOT_LEAK",
            },
          ],
        },
      };
    },
  };

  const handlers = createCatalogIpcHandlers({
    getMainWindow: () => mainWin,
    getCatalogService: () => fakeService,
  });

  // 1. Untrusted senders are refused on every channel
  const untrustedEvents = [
    { sender: {}, senderFrame: mainWin.webContents.mainFrame },
    { sender: mainWin.webContents, senderFrame: { url: "melodious://app/" } },
    {
      sender: mainWin.webContents,
      senderFrame: { url: "https://accounts.logi.com/" },
    },
  ];
  for (const channel of Object.values(CATALOG_CHANNELS)) {
    for (const badEvent of untrustedEvents) {
      await assert.rejects(
        () => handlers[channel](badEvent, { id: 1, manufacturer: "Sony", model: "X" }),
        /Untrusted IPC sender/
      );
    }
  }

  // 2. Trusted calls strip extra/secret fields and return only the bridge contract
  const st = await handlers[CATALOG_CHANNELS.status](trustedEvent);
  assert.deepEqual(st, { signedIn: true });
  await assert.rejects(handlers[CATALOG_CHANNELS.status](trustedEvent, {}), /Invalid catalog arguments/);
  await assert.rejects(handlers[CATALOG_CHANNELS.search](trustedEvent, { manufacturer: "Sony", model: "X", extra: "refused" }), /Invalid catalog arguments/);

  const si = await handlers[CATALOG_CHANNELS.signIn](trustedEvent);
  assert.deepEqual(si, { signedIn: true });

  const so = await handlers[CATALOG_CHANNELS.signOut](trustedEvent);
  assert.deepEqual(so, { signedIn: false });

  const cm = await handlers[CATALOG_CHANNELS.checkModel](trustedEvent, {
    manufacturer: "  Sony ",
    model: " STR-DG7 ",
  });
  assert.deepEqual(cm, {
    found: true,
    manufacturer: "Sony",
    model: "STR-DG720",
  });

  const sr = await handlers[CATALOG_CHANNELS.search](trustedEvent, {
    manufacturer: "Sony",
    model: "STR-DG7",
  });
  assert.deepEqual(sr, [
    {
      id: 167856,
      manufacturer: "Sony",
      model: "STR-DG720",
      displayText: "Sony STR-DG720",
      deviceType: "Receiver",
      description: "AV Receiver",
    },
  ]);

  const dl = await handlers[CATALOG_CHANNELS.download](trustedEvent, {
    id: 167856,
    manufacturer: "Sony",
    model: "STR-DG720",
  });
  assert.equal(JSON.stringify(dl).includes("MUST_NOT_LEAK"), false);
  assert.equal(dl.resources.selected_match.AccountId, "[REDACTED]");
  assert.equal(dl.resources.global_language_commands[0].access_token, "[REDACTED]");

  // 3. Invalid arguments are refused
  await assert.rejects(
    () =>
      handlers[CATALOG_CHANNELS.search](trustedEvent, {
        manufacturer: "",
        model: "STR-DG7",
      }),
    /Invalid manufacturer/
  );
  await assert.rejects(
    () =>
      handlers[CATALOG_CHANNELS.download](trustedEvent, {
        id: "167856",
        manufacturer: "Sony",
        model: "STR-DG720",
      }),
    /Invalid catalog device id/
  );

  // 4. Plain error messages come back intact
  await assert.rejects(
    () =>
      handlers[CATALOG_CHANNELS.search](trustedEvent, {
        manufacturer: "Sony",
        model: "NONE",
      }),
    /^Error: No catalog device matches Sony NONE$/
  );
});
