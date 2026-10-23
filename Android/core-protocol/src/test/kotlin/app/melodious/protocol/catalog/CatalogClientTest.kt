package app.melodious.protocol.catalog

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private class FixtureHttp(
    private val fixtures: JsonObject,
    private val posts: MutableList<Pair<String, kotlinx.serialization.json.JsonElement>> = mutableListOf(),
    private val signinBearer: String = "fixture-acc",
) : CatalogHttp {
    override suspend fun get(url: String): CatalogHttpResponse {
        return if (url.contains("/manf/Sony/model/STR-DG720/")) {
            CatalogHttpResponse(200, fixture(fixtures, "searchDeviceFound"))
        } else {
            CatalogHttpResponse(200, fixture(fixtures, "searchDeviceNotFound"))
        }
    }

    override suspend fun postJson(
        url: String,
        payload: kotlinx.serialization.json.JsonElement,
        bearer: String?,
        extraHeaders: Map<String, String>,
    ): CatalogHttpResponse {
        posts.add(url to payload)
        return when {
            url == HARMONY_SIGNIN_URL -> CatalogHttpResponse(
                200, buildJsonObject { put("AccountId", "fixture-account") }
            )
            url == DISCOVERY_URL -> CatalogHttpResponse(200, fixture(fixtures, "discovery"))
            url.endsWith("/json2/SearchGlobalDevices") ->
                CatalogHttpResponse(200, fixture(fixtures, "searchGlobalDevices"))
            url.endsWith("/json2/GetGlobalDevices") ->
                CatalogHttpResponse(200, fixture(fixtures, "getGlobalDevices"))
            url.endsWith("/json/GetGlobalLanguageCommands") ->
                CatalogHttpResponse(200, fixture(fixtures, "getGlobalLanguageCommands"))
            else -> throw AssertionError("unexpected POST $url")
        }
    }

    override suspend fun postForm(url: String, fields: Map<String, String>): CatalogHttpResponse =
        throw AssertionError("unexpected form POST $url")

    override fun clearCookies() {}
}

class CatalogClientTest {

    private val fixtures = loadCatalogFixtures()

    @Test
    fun `parseOperations keeps valid entries, swaps hosts, and builds endpoints`() {
        val ops = parseOperations(fixture(fixtures, "discovery"))
        assertEquals(4, ops.size)
        val search = ops.getValue(SEARCH_OPERATION)
        assertEquals(
            "https://cf-svcs.myharmony.com/HarmonyPlatform/DeviceManager.svc/json2/SearchGlobalDevices",
            search.endpoint(json2 = true),
        )
        assertEquals(
            "https://lb-svcs.myharmony.com/HarmonyPlatform/DeviceManager.svc/json2/SearchGlobalDevices",
            loadBalancerAddress(search.endpoint(json2 = true)),
        )
        assertEquals(
            "https://cf-svcs.myharmony.com/HarmonyPlatform/DeviceManager.svc/json/SearchGlobalDevices",
            search.endpoint(),
        )
    }

    @Test
    fun `swapHost and loadBalancerAddress leave unparseable and foreign addresses alone`() {
        assertEquals(
            "http://revue.logitech.com/DigitalHome/tv/GetSupportPolicy2",
            loadBalancerAddress("http://revue.logitech.com/DigitalHome/tv/GetSupportPolicy2"),
        )
        assertEquals("not a url", swapHost("not a url", setOf("svcs.myharmony.com"), "lb-svcs.myharmony.com"))
        assertEquals(
            "https://other.example/a",
            swapHost("https://other.example/a", setOf("svcs.myharmony.com"), "x"),
        )
    }

    @Test
    fun `parseOperations skips malformed entries and throws when nothing survives`() {
        val payload = buildJsonObject {
            put("GetJsonOperationsResult", buildJsonArray {
                add(buildJsonObject { put("Identifier", "A/B"); put("Address", "https://svcs.myharmony.com/x/"); put("Name", "B") })
                add(buildJsonObject { put("Identifier", ""); put("Address", "https://svcs.myharmony.com/x/"); put("Name", "B") })
                add(buildJsonObject { put("Identifier", "C/D"); put("Name", "D") })
                add(JsonPrimitive("junk"))
            })
        }
        assertEquals(listOf("A/B"), parseOperations(payload).keys.toList())
        assertThrows(CatalogError::class.java) {
            parseOperations(buildJsonObject { put("GetJsonOperationsResult", buildJsonArray { }) })
        }.also { assertEquals("discovery carried no usable operation", it.message) }
        assertThrows(CatalogError::class.java) { parseOperations(buildJsonObject { }) }
            .also { assertEquals("discovery did not return an operation table", it.message) }
        assertThrows(CatalogError::class.java) { parseOperations(null) }
    }

    @Test
    fun `GetGlobalLanguageCommands falls back to the GetCommands sibling address, not json2`() = runBlocking {
        val posts = mutableListOf<Pair<String, kotlinx.serialization.json.JsonElement>>()
        val http = FixtureHttp(fixtures, posts)
        val client = GlobalCatalogClient(
            http,
            CatalogSession("fixture-account", CatalogTokens("fixture-acc", "fixture-id")),
        )
        val commands = client.globalLanguageCommands(JsonPrimitive(25932))
        assertTrue(commands is JsonArray)
        assertEquals(5, (commands as JsonArray).size)
        val commandUrl = posts.last().first
        assertEquals(
            "https://lb-svcs.myharmony.com/HarmonyPlatform/DeviceManager.svc/json/GetGlobalLanguageCommands",
            commandUrl,
        )
        val body = posts.last().second as JsonObject
        assertEquals("25932", ((body["globalLanguageVersionId"] as JsonObject)["Value"] as JsonPrimitive).content)
        // Operation table was cached: only one discovery POST.
        assertEquals(1, posts.count { it.first == DISCOVERY_URL })
    }

    @Test
    fun `checkDeviceModel canonicalises the found device and echoes inputs when missing`() = runBlocking {
        val http = FixtureHttp(fixtures)
        val found = checkDeviceModel(http, "Sony", "STR-DG720")
        assertTrue(found.found)
        assertEquals("Sony", found.manufacturer)
        assertEquals("STR-DG720", found.model)
        val missing = checkDeviceModel(http, "Sony", "UNKNOWN")
        assertFalse(missing.found)
        assertEquals("Sony", missing.manufacturer)
        assertEquals("UNKNOWN", missing.model)
    }

    @Test
    fun `formatDeviceType uses the label table and falls back for unknowns`() {
        assertEquals("Receiver", formatDeviceType(JsonPrimitive(5)))
        assertEquals("Television", formatDeviceType(JsonPrimitive(1)))
        assertEquals("Type 99", formatDeviceType(JsonPrimitive(99)))
        assertEquals("", formatDeviceType(JsonPrimitive(0)))
        assertEquals("Custom", formatDeviceType(JsonPrimitive("  Custom  ")))
        assertEquals("", formatDeviceType(null))
    }

    @Test
    fun `searchMatches rejects missing or non-array Matches`() {
        assertThrows(CatalogError::class.java) { searchMatches(buildJsonObject { }) }
            .also { assertTrue(it.message!!.contains("manufacturer AND the model")) }
        assertThrows(CatalogError::class.java) {
            searchMatches(buildJsonObject { put("Matches", JsonPrimitive("no")) })
        }.also { assertEquals("SearchGlobalDevices did not return Matches", it.message) }
        assertThrows(CatalogError::class.java) { searchMatches(buildJsonArray { }) }
            .also { assertEquals("SearchGlobalDevices did not return an object", it.message) }
    }
}
