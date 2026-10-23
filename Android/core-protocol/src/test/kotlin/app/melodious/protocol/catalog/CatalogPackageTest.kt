package app.melodious.protocol.catalog

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogPackageTest {

    @Test
    fun `redact strips secret keys recursively and leaves command data intact`() {
        val input = buildJsonObject {
            put("Manufacturer", "Sony")
            put("access_token", "secret-1")
            put("RefreshToken", "secret-2")
            put("id_token", "secret-3")
            put("AccountId", "secret-4")
            put("nested", buildJsonObject {
                put("Authorization", "Bearer xyz")
                put("Cookie", "sid=abc")
                put("Password", "pw")
                put("KeyCode", "G:Sony 15 Bit:()(0x3A0C)():3")
            })
            put("list", buildJsonArray {
                add(buildJsonObject { put("secretKey", "hidden"); put("Name", "PowerOn") })
            })
        }
        val out = redact(input) as JsonObject
        assertEquals("Sony", (out["Manufacturer"] as JsonPrimitive).content)
        for (key in listOf("access_token", "RefreshToken", "id_token", "AccountId")) {
            assertEquals("[REDACTED]", (out[key] as JsonPrimitive).content)
        }
        val nested = out["nested"] as JsonObject
        assertEquals("[REDACTED]", (nested["Authorization"] as JsonPrimitive).content)
        assertEquals("[REDACTED]", (nested["Cookie"] as JsonPrimitive).content)
        assertEquals("[REDACTED]", (nested["Password"] as JsonPrimitive).content)
        assertEquals("G:Sony 15 Bit:()(0x3A0C)():3", (nested["KeyCode"] as JsonPrimitive).content)
        val first = (out["list"] as JsonArray)[0] as JsonObject
        assertEquals("[REDACTED]", (first["secretKey"] as JsonPrimitive).content)
        assertEquals("PowerOn", (first["Name"] as JsonPrimitive).content)
    }

    @Test
    fun `buildPackage uses the 0_2_0 schema and the Android source`() {
        val pkg = buildPackage(
            manufacturer = "Sony",
            model = "STR-DG720",
            searchResult = buildJsonObject { put("access_token", "secret"); put("Matches", buildJsonArray { }) },
            selectedMatch = buildJsonObject { put("Id-", JsonPrimitive(167856)) },
            globalDevice = buildJsonObject { put("Id", JsonPrimitive(167856)) },
            languageCommands = buildJsonArray {
                add(buildJsonObject { put("Name", "PowerOn"); put("KeyCode", "G:Sony 15 Bit:()(0x3A0C)():3") })
            },
            generatedAt = "2026-10-23T00:00:00Z",
        )
        assertEquals("0.2.0", (pkg["schema_version"] as JsonPrimitive).content)
        assertEquals("2026-10-23T00:00:00Z", (pkg["generated_at"] as JsonPrimitive).content)
        assertEquals("logitech-catalog-via-melodious-android", (pkg["source"] as JsonPrimitive).content)
        val query = pkg["query"] as JsonObject
        assertEquals("Sony", (query["manufacturer"] as JsonPrimitive).content)
        assertEquals("STR-DG720", (query["model"] as JsonPrimitive).content)
        val resources = pkg["resources"] as JsonObject
        assertEquals(
            "[REDACTED]",
            ((resources["search_result"] as JsonObject)["access_token"] as JsonPrimitive).content,
        )
        assertEquals(1, (resources["global_language_commands"] as JsonArray).size)
        assertTrue(isCatalogPackage(pkg))
    }

    @Test
    fun `isCatalogPackage accepts only 0_2_0 packages with a commands array`() {
        fun pkg(schema: String, commands: kotlinx.serialization.json.JsonElement?) = buildJsonObject {
            put("schema_version", schema)
            put("resources", buildJsonObject {
                if (commands != null) put("global_language_commands", commands)
            })
        }
        assertTrue(isCatalogPackage(pkg("0.2.0", buildJsonArray { })))
        assertFalse(isCatalogPackage(null))
        assertFalse(isCatalogPackage(buildJsonArray { }))
        assertFalse(isCatalogPackage(buildJsonObject { }))
        assertFalse(isCatalogPackage(JsonPrimitive("0.2.0")))
        assertFalse(isCatalogPackage(pkg("1.0", buildJsonArray { })))
        assertFalse(isCatalogPackage(pkg("0.2.0", buildJsonObject { })))
        assertFalse(isCatalogPackage(pkg("0.2.0", null)))
    }
}
