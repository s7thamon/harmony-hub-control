package app.melodious.protocol.catalog

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private val PKG_JSON = """
{
  "schema_version": "0.2.0",
  "resources": {
    "global_language_commands": [
      { "Name": "PowerOn", "KeyCode": "G:Sony 15 Bit:()(0x3A0C)():3", "ProtocolId": 17 },
      { "Name": "PowerOff", "KeyCode": "G:Sony 15 Bit:()(0x7A0C)():3", "ProtocolId": 17 },
      { "Name": "VolumeUp", "KeyCode": "G:Sony 15 Bit:()(0x240C)():3", "ProtocolId": 17 },
      { "Name": "SmartKey", "KeyCode": "G:RC6 Mode 0:()(0x1)():0", "ProtocolId": 999 },
      { "Name": "LearnedRaw", "KeyCode": "", "Raw": "F38000P500S500" },
      { "Name": "Broken", "KeyCode": "", "Raw": "" },
      { "Name": "", "KeyCode": "G:Sony 15 Bit:()(0x1)():3", "ProtocolId": 17 }
    ]
  }
}
""".trimIndent()

class CatalogImportTest {

    private fun pkg() = Json.parseToJsonElement(PKG_JSON)

    @Test
    fun `isCatalogPackage mirrors the JS accept and reject set`() {
        assertTrue(isCatalogPackage(pkg()))
        assertTrue(isCatalogPackage(Json.parseToJsonElement("""{"schema_version":"0.2.0","resources":{"global_language_commands":[]}}""")))
        for (bad in listOf(
            "null",
            "[]",
            "{}",
            "\"0.2.0\"",
            """{"schema_version":"1.0","resources":{"global_language_commands":[]}}""",
            """{"schema_version":"0.2.0","resources":{"global_language_commands":{}}}""",
        )) {
            assertFalse("should reject: $bad", isCatalogPackage(Json.parseToJsonElement(bad)))
        }
    }

    @Test
    fun `catalogRows imports only KeyCodes whose protocol is on the hub`() {
        val result = catalogRows(pkg(), listOf("Sony 15 Bit", "Toshiba 32 Bit"))
        assertEquals(listOf("PowerOn", "PowerOff", "VolumeUp", "LearnedRaw"), result.rows.map { it.name })
        assertEquals(listOf("Sony 15 Bit"), result.protocolsUsed)
        assertEquals(listOf("RC6 Mode 0"), result.missingProtocols)
        assertEquals(3, result.skipped.size)
        assertTrue(result.skipped[0].reason.contains("RC6 Mode 0"))
        // Exact JS wording, including the curly quotes.
        assertEquals("protocol “RC6 Mode 0” is not on this hub", result.skipped[0].reason)
        assertEquals("(unnamed)", result.skipped[2].name)
        assertEquals("no command name", result.skipped[2].reason)
        // The Raw row carries no keycode; the KeyCode rows carry no raw.
        assertEquals("", result.rows[3].keycode)
        assertEquals("F38000P500S500", result.rows[3].raw)
        assertEquals("G:Sony 15 Bit:()(0x3A0C)():3", result.rows[0].keycode)
        assertEquals("", result.rows[0].raw)
        assertEquals("Sony 15 Bit", result.rows[0].protocol)
    }

    @Test
    fun `catalogRows refuses every KeyCode when no protocol list is known`() {
        val result = catalogRows(pkg(), emptyList())
        assertEquals(listOf("LearnedRaw"), result.rows.map { it.name })
        assertEquals(listOf("RC6 Mode 0", "Sony 15 Bit"), result.missingProtocols.sorted())
    }

    @Test
    fun `catalogRows handles a package without commands`() {
        val result = catalogRows(Json.parseToJsonElement("""{"resources":{}}"""), listOf("Sony 15 Bit"))
        assertEquals(0, result.rows.size)
        assertEquals(0, result.skipped.size)
    }

    @Test
    fun `catalogRows reports every skip reason`() {
        val tricky = Json.parseToJsonElement(
            """
            {"resources":{"global_language_commands":[
              {"Name":"NoProto","KeyCode":"G::(0x1)"},
              {"Name":"BadForm","KeyCode":"X:1"},
              {"Name":"Empty","KeyCode":"","Raw":""}
            ]}}
            """.trimIndent()
        )
        val result = catalogRows(tricky, listOf("Sony 15 Bit"))
        assertEquals(listOf("KeyCode names no protocol", "KeyCode is not in Harmony G: form", "no KeyCode or Raw code"),
            result.skipped.map { it.reason })
    }

    @Test
    fun `describeCatalogRows summarises importable, skipped and missing protocols`() {
        val text = describeCatalogRows(catalogRows(pkg(), listOf("Sony 15 Bit")))
        assertTrue(text.startsWith("4 importable"))
        assertTrue(text.contains("Sony 15 Bit"))
        assertTrue(text.contains("missing on hub: RC6 Mode 0"))
        assertEquals(
            "4 importable · protocols: Sony 15 Bit · 3 skipped · missing on hub: RC6 Mode 0",
            text,
        )
    }

    @Test
    fun `hubProtocolNames reads names out of a ProtocolList export`() {
        assertEquals(
            listOf("Sony 15 Bit", "Toshiba 32 Bit"),
            hubProtocolNames(
                Json.parseToJsonElement(
                    """{"Protocols":[{"Name":"Sony 15 Bit"},{"Name":"Toshiba 32 Bit"},{}]}"""
                )
            ),
        )
        assertEquals(emptyList<String>(), hubProtocolNames(null))
        assertEquals(emptyList<String>(), hubProtocolNames(JsonPrimitive("junk")))
    }
}
