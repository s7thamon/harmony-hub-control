package app.melodious.protocol.rest

import app.melodious.protocol.catalog.CatalogCommandRow
import app.melodious.protocol.catalog.catalogRows
import app.melodious.protocol.catalog.loadCatalogFixtures
import app.melodious.protocol.model.HubEndpoint
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Opt-in cross-checks against a locally running server, mirroring the
 * opt-in shape of `desktop/test/hub-emu.mjs`. Nothing here runs unless
 * `MELODIOUS_HUB_BASE_URL` is set (loopback only), so the default
 * `:core-protocol:test` run stays hermetic and green.
 *
 * Two servers answer the same routes:
 * - webui-sim: `PORT=8799 node tools/webui-sim/server.mjs` — the Node mock
 * - hub-emu: `tools/hub-emu/run.sh` — the real MIPS `codex_webui` under
 *   qemu. This is the check that counts for request framing: the sim's Node
 *   stack accepts chunked bodies and would hide a framing bug, while the C
 *   parser reads only `Content-Length` (a chunked catalog-import is refused
 *   with "The request body was empty.").
 *
 * No IR is ever sent. The tests only read `/export/protocols`,
 * `/export/devices` and post `/api/catalog-import` fixture rows plus the
 * IR lab helpers `/api/ir-lab-target` and `/api/ir-lab-clear`.
 *
 * Run:
 * ```
 * MELODIOUS_HUB_BASE_URL=http://127.0.0.1:8799 \
 *   JAVA_HOME=... ./gradlew --offline :core-protocol:test --tests "*HubCrossCheckTest*"
 * MELODIOUS_HUB_BASE_URL=http://127.0.0.1:8788 \
 *   JAVA_HOME=... ./gradlew --offline :core-protocol:test --tests "*HubCrossCheckTest*"
 * ```
 *
 * Env knobs:
 * - `MELODIOUS_HUB_BASE_URL` (required, loopback only: `http://127.0.0.1:<port>`)
 * - `MELODIOUS_HUB_SERVER` = `sim` (default) or `hub-emu`. Only changes the
 *   expected refusal message for the missing-protocol row and whether Sony
 *   protocol records must be seeded into hub-emu before the import.
 */
class HubCrossCheckTest {

    private val baseUrl: String
        get() = System.getenv("MELODIOUS_HUB_BASE_URL")?.trim()?.trimEnd('/').orEmpty()

    private val isHubEmu: Boolean
        get() = System.getenv("MELODIOUS_HUB_SERVER")?.trim()?.equals("hub-emu", ignoreCase = true) == true

    private fun requireServer() {
        assumeTrue(
            "Set MELODIOUS_HUB_BASE_URL=http://127.0.0.1:<port> to run the opt-in hub cross-checks " +
                "(webui-sim on its port, or hub-emu on 8788).",
            baseUrl.isNotEmpty(),
        )
        assertTrue(
            "MELODIOUS_HUB_BASE_URL must be loopback (http://127.0.0.1:<port>), got: $baseUrl",
            baseUrl.matches(Regex("""http://127\.0\.0\.1:\d+""")),
        )
        assertTrue(
            "MELODIOUS_HUB_SERVER must be unset, sim, or hub-emu, got: " +
                System.getenv("MELODIOUS_HUB_SERVER"),
            System.getenv("MELODIOUS_HUB_SERVER")?.trim().let {
                it == null || it.isEmpty() || it.equals("sim", true) || it.equals("hub-emu", true)
            },
        )
    }

    private fun endpoint(): HubEndpoint {
        val port = baseUrl.substringAfterLast(":").toInt()
        return HubEndpoint(name = "cross-check", host = "127.0.0.1", webUiPort = port)
    }

    private fun httpGet(path: String): Pair<Int, String> {
        val conn = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
        }
        return try {
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.readBytes()?.toString(Charsets.UTF_8).orEmpty()
            code to body
        } finally {
            conn.disconnect()
        }
    }

    private fun httpPostJson(path: String, jsonBody: String): Pair<Int, String> {
        val bodyBytes = jsonBody.toByteArray(Charsets.UTF_8)
        val conn = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setFixedLengthStreamingMode(bodyBytes.size)
        }
        return try {
            conn.outputStream.use { it.write(bodyBytes) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.readBytes()?.toString(Charsets.UTF_8).orEmpty()
            code to body
        } finally {
            conn.disconnect()
        }
    }

    /**
     * `/api/ir-lab-target` with an empty JSON body, mirroring how the
     * desktop suite creates the lab device. The real `codex_webui` ignores
     * the body for this route; the sim's `handleIrLabTarget` does the same.
     */
    private fun ensureLabDeviceId(): String {
        val (code, body) = httpPostJson("/api/ir-lab-target", "{}")
        assertEquals("ir-lab-target HTTP status (body: $body)", 200, code)
        val root = Json.parseToJsonElement(body).jsonObject
        assertEquals("ir-lab-target ok (body: $body)", "true", root["ok"]?.jsonPrimitive?.content)
        val deviceId = root["deviceId"]?.jsonPrimitive?.content.orEmpty()
        assertTrue("ir-lab-target returned a deviceId (body: $body)", deviceId.isNotEmpty())
        return deviceId
    }

    /** Clears the lab device; both servers accept form-encoded or JSON params. */
    private fun clearLab(deviceId: String) {
        val bodyBytes = "deviceId=$deviceId".toByteArray(Charsets.UTF_8)
        val conn = (URL("$baseUrl/api/ir-lab-clear").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            setFixedLengthStreamingMode(bodyBytes.size)
        }
        try {
            conn.outputStream.use { it.write(bodyBytes) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.readBytes()?.toString(Charsets.UTF_8).orEmpty()
            assertEquals("ir-lab-clear HTTP status (body: $body)", 200, code)
        } finally {
            conn.disconnect()
        }
    }

    /** Seed Sony 15/20 Bit protocol records into hub-emu only, like hub-emu.mjs. */
    private fun seedSonyProtocolsOnHubEmuIfNeeded(protocolNamesNow: List<String>) {
        if (!isHubEmu) return
        if (protocolNamesNow.containsAll(listOf("Sony 15 Bit", "Sony 20 Bit"))) return
        val script = """
            import json
            p='/data/resources/ProtocolList.json'
            v=json.load(open(p))
            for n,i in [('Sony 15 Bit',17),('Sony 20 Bit',18)]:
                if not any(x.get('Name')==n for x in v['Protocols']):
                    v['Protocols'].append({'Id-':i,'Name':n})
            open(p,'w').write(json.dumps(v,separators=(',',':')))
        """.trimIndent()
        val process = ProcessBuilder(
            "docker", "exec", "hub-emu", "python3", "-c", script,
        ).redirectErrorStream(true).start()
        val output = process.inputStream.readBytes().toString(Charsets.UTF_8)
        val exit = process.waitFor()
        assertEquals("seeding Sony protocols into hub-emu failed: $output", 0, exit)
    }

    /** Fixture rows whose protocols exist on both servers (Sony 15/20 Bit). */
    private fun fixtureRows(): List<CatalogCommandRow> {
        val fixtures = loadCatalogFixtures()
        val wire = fixtures["getGlobalLanguageCommands"]!!.jsonObject
        val commands = wire["GetGlobalLanguageCommandsResult"]!!.jsonArray
        // Build a 0.2.0-shaped package from the first 4 fixture commands and
        // let the real Kotlin catalogRows decide importability, exactly as
        // the app does.
        val packageText = buildString {
            append("""{"schema_version":"0.2.0","resources":{"global_language_commands":[""")
            append(commands.take(4).joinToString(",") { it.toString() })
            append("]}}")
        }
        val pkg = Json.parseToJsonElement(packageText)
        val plan = catalogRows(pkg, listOf("Sony 15 Bit", "Sony 20 Bit"))
        assertEquals("fixture plan rows", 4, plan.rows.size)
        assertEquals("fixture plan skipped", 0, plan.skipped.size)
        return plan.rows
    }

    private fun fixtureCommands(): List<JsonFixtureCommand> {
        val fixtures = loadCatalogFixtures()
        val wire = fixtures["getGlobalLanguageCommands"]!!.jsonObject
        val commands = wire["GetGlobalLanguageCommandsResult"]!!.jsonArray
        return commands.map { el ->
            val obj = el.jsonObject
            JsonFixtureCommand(
                name = obj["Name"]!!.jsonPrimitive.content,
                keyCode = obj["KeyCode"]!!.jsonPrimitive.content,
                protocolId = obj["ProtocolId"]!!.jsonPrimitive.content.toInt(),
            )
        }
    }

    private data class JsonFixtureCommand(val name: String, val keyCode: String, val protocolId: Int)

    /** Stored commands for [deviceId] read from `/export/devices`. */
    private fun storedCommands(deviceId: String): Map<String, Pair<String, Int>> {
        val (code, body) = httpGet("/export/devices")
        assertEquals("export/devices HTTP status", 200, code)
        val root = Json.parseToJsonElement(body).jsonObject
        val entries = root["DevicesWithFeatures"]!!.jsonArray
        val entry = entries.firstOrNull { el ->
            el.jsonObject["Device"]?.jsonObject?.get("Id-")?.jsonPrimitive?.content == deviceId
        } ?: error("device $deviceId not in /export/devices")
        val commands = entry.jsonObject["Commands"]?.jsonArray ?: return emptyMap()
        return commands.associate { el ->
            val obj = el.jsonObject
            val name = obj["Name"]!!.jsonPrimitive.content
            val keyCode = obj["KeyCode"]?.jsonPrimitive?.content.orEmpty()
            val protocolId = obj["ProtocolId"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
            name to (keyCode to protocolId)
        }
    }

    @Test
    fun `reads hub protocol names`() = runBlocking {
        requireServer()
        val client = CodexHubRestClient()
        val names = client.getHubProtocolNames(endpoint())

        if (isHubEmu) {
            // hub-emu seeds an empty ProtocolList; the Sony records are
            // seeded by this suite before the import test. Either state is
            // a correct read: what matters is the GET parses.
            assertTrue(
                "hub-emu protocol names parsed: $names",
                names.all { it.isNotEmpty() },
            )
        } else {
            assertTrue("sim knows Sony 15 Bit: $names", names.contains("Sony 15 Bit"))
            assertTrue("sim knows Sony 20 Bit: $names", names.contains("Sony 20 Bit"))
        }
    }

    @Test
    fun `imports the 4 fixture KeyCodes byte-identical with ProtocolId 17 and 18`() = runBlocking {
        requireServer()
        val client = CodexHubRestClient()
        val ep = endpoint()

        seedSonyProtocolsOnHubEmuIfNeeded(client.getHubProtocolNames(ep))

        val names = client.getHubProtocolNames(ep)
        assertTrue("Sony 15 Bit on server: $names", names.contains("Sony 15 Bit"))
        assertTrue("Sony 20 Bit on server: $names", names.contains("Sony 20 Bit"))

        val labId = ensureLabDeviceId()
        try {
            clearLab(labId)

            val rows = fixtureRows()
            val reply = client.importCatalogCommands(ep, labId, rows)
            assertEquals("true", reply["ok"]?.jsonPrimitive?.content)
            assertTrue(
                "import message: ${reply["message"]}",
                reply["message"]?.jsonPrimitive?.content?.contains("Imported: 4") == true,
            )

            val stored = storedCommands(labId)
            assertEquals("stored command count", 4, stored.size)
            for (expected in fixtureCommands().take(4)) {
                val actual = stored[expected.name]
                    ?: error("stored commands missing ${expected.name}: ${stored.keys}")
                assertEquals("KeyCode for ${expected.name}", expected.keyCode, actual.first)
                assertEquals("ProtocolId for ${expected.name}", expected.protocolId, actual.second)
            }
        } finally {
            runCatching { clearLab(labId) }
        }
    }

    @Test
    fun `refuses the fixture row whose protocol the hub lacks`() = runBlocking {
        requireServer()
        val client = CodexHubRestClient()
        val ep = endpoint()

        seedSonyProtocolsOnHubEmuIfNeeded(client.getHubProtocolNames(ep))
        val labId = ensureLabDeviceId()
        try {
            clearLab(labId)

            // The 5th fixture command names "RC6 Mode 0"; neither server
            // has that protocol, so the import gate must refuse it. The
            // row is posted directly (bypassing catalogRows, which would
            // skip it client-side) to prove the server-side gate.
            val smartKey = fixtureCommands()[4]
            assertEquals("SmartKey", smartKey.name)
            val error = assertThrows(HubApiException::class.java) {
                runBlocking {
                    client.importCatalogCommands(
                        ep,
                        labId,
                        listOf(
                            CatalogCommandRow(smartKey.name, smartKey.keyCode, "", "RC6 Mode 0"),
                        ),
                    )
                }
            }
            assertEquals(400, error.statusCode)
            // Both servers refuse with Rejected: 1. Only the wording of the
            // refusal differs: the sim collapses every no-import case into
            // a generic message ("Submitted: … Rejected: 1" via its `error`
            // field), while the real codex_webui distinguishes "Backend
            // rejected malformed/raw commands." for this case. Assert the
            // shared contract (400 + Rejected: 1) plus each server's actual
            // wording, rather than forcing one expectation on both.
            val message = error.message.orEmpty()
            assertTrue("refusal reports Rejected: 1: $message", message.contains("Rejected: 1"))
            if (isHubEmu) {
                assertTrue(
                    "hub-emu refusal wording: $message",
                    message.contains("Backend rejected malformed/raw commands."),
                )
            }
            // Nothing was stored for the refused row.
            assertTrue(
                "refused row not stored: ${storedCommands(labId).keys}",
                smartKey.name !in storedCommands(labId),
            )
        } finally {
            runCatching { clearLab(labId) }
        }
    }

    @Test
    fun `unreachable server is refused before any fixture row is sent`() {
        // Guard rail for the opt-in shape itself: an endpoint that does not
        // answer must fail with an IO error, never silently succeed. Uses a
        // loopback port with no listener, so it is safe unattended.
        val client = CodexHubRestClient()
        val dead = HubEndpoint(name = "dead", host = "127.0.0.1", webUiPort = 1)
        assertThrows(IOException::class.java) {
            runBlocking { client.getHubProtocolNames(dead) }
        }
    }
}
