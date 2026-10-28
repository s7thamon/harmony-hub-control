package app.melodious.protocol.update

import app.melodious.protocol.model.HubEndpoint
import app.melodious.protocol.rest.CodexHubRestClient
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import kotlin.concurrent.thread

private const val REPO_URL = "https://github.com/schlambos/harmony-hub-control"

private fun releases(vararg specs: Triple<String, List<String>, Map<String, Any>>): JsonArray = buildJsonArray {
    for ((tag, assets, extra) in specs) addJsonObject {
        put("tag_name", tag)
        put("draft", extra["draft"] as? Boolean ?: false)
        put("prerelease", extra["prerelease"] as? Boolean ?: false)
        put("html_url", extra["html_url"] as? String ?: "$REPO_URL/releases/tag/$tag")
        put("published_at", "2026-10-28T00:00:00Z")
        putJsonArray("assets") {
            for (name in assets) addJsonObject {
                put("name", name)
                put("browser_download_url", extra["download"] as? String ?: "$REPO_URL/releases/download/$tag/$name")
            }
        }
    }
}

private fun full(v: String, extra: Map<String, Any> = emptyMap()) =
    Triple("v$v", listOf("melodious-hub-$v.zip", "melodious-$v.apk", "Melodious-$v-arm64.zip"), extra)

/** Answers each connection with the next canned response; records request headers. */
private class CannedServer(private val replies: List<Pair<Int, String>>, private val headers: Map<String, String> = emptyMap()) {
    private val server = ServerSocket(0)
    val port get() = server.localPort
    val requests = mutableListOf<Map<String, String>>()

    init {
        thread(isDaemon = true) {
            for ((status, body) in replies) {
                server.accept().use { socket ->
                    val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.ISO_8859_1))
                    val seen = LinkedHashMap<String, String>()
                    seen["request-line"] = reader.readLine().orEmpty()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        val i = line.indexOf(':')
                        if (i > 0) seen[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
                    }
                    synchronized(requests) { requests += seen }
                    val bytes = body.toByteArray()
                    val extra = headers.entries.joinToString("") { "${it.key}: ${it.value}\r\n" }
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 $status X\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\n${extra}Connection: close\r\n\r\n".toByteArray())
                        write(bytes)
                        flush()
                    }
                }
            }
            server.close()
        }
    }
}

class ReleaseUpdatesTest {
    @Test
    fun versionsCompareNumerically() {
        assertTrue(ReleaseVersion.parse("1.10.0")!! > ReleaseVersion.parse("1.9.9")!!)
        assertNull(ReleaseVersion.parse("1.2"))
        assertNull(ReleaseVersion.parse("v1.2.0"))
    }

    @Test
    fun onlyHttpsGitHubUrlsInThisRepoCount() {
        assertTrue(GitHubReleases.isGitHubUrl("$REPO_URL/releases/tag/v1.3.0"))
        assertTrue(GitHubReleases.isGitHubUrl("https://release-assets.githubusercontent.com/a/b"))
        assertFalse(GitHubReleases.isGitHubUrl("http://github.com/schlambos/harmony-hub-control/releases"))
        assertFalse(GitHubReleases.isGitHubUrl("https://github.com/someone-else/harmony-hub-control/releases"))
        assertFalse(GitHubReleases.isGitHubUrl("https://github.com.evil.example/schlambos/harmony-hub-control/"))
        assertFalse(GitHubReleases.isGitHubUrl("https://github.com:8443/schlambos/harmony-hub-control/"))
        assertFalse(GitHubReleases.isGitHubUrl("nonsense"))
    }

    @Test
    fun picksNewestPublishedReleaseWithTheApk() {
        val list = releases(
            full("1.5.0", mapOf("draft" to true)),
            full("1.4.0", mapOf("prerelease" to true)),
            Triple("desktop-v1.3.5", listOf("Melodious-1.3.5-arm64.zip"), emptyMap()),
            full("1.3.0"),
            full("1.2.0"),
        )
        assertEquals("1.3.0", GitHubReleases.latestAndroid(list)?.version)
        assertEquals("1.3.0", GitHubReleases.latestHub(list)?.version)
    }

    @Test
    fun releasesWhoseLinksLeaveTheRepoAreIgnored() {
        val list = releases(
            full("9.0.0", mapOf("html_url" to "https://github.com/someone-else/harmony-hub-control/releases/tag/v9.0.0")),
            full("8.0.0", mapOf("download" to "https://downloads.evil.example/x.apk")),
            full("1.3.0"),
        )
        assertEquals("1.3.0", GitHubReleases.latestAndroid(list)?.version)
    }

    @Test
    fun hubNotes() {
        val latest = LatestRelease("1.3.0", "v1.3.0", "$REPO_URL/releases/tag/v1.3.0")
        assertTrue(GitHubReleases.hubNote(HubSoftware.Legacy, latest).contains("1.2 or older"))
        assertTrue(GitHubReleases.hubNote(HubSoftware.Known("1.2.5"), latest).contains("runs Melodious 1.2.5"))
        assertEquals("", GitHubReleases.hubNote(HubSoftware.Known("1.3.0"), latest))
        assertEquals("", GitHubReleases.hubNote(null, latest))
    }

    @Test
    fun fetchSendsUserAgentAndEtagAndReadsAnswers() = runBlocking {
        val body = """[{"tag_name":"v1.3.0","draft":false,"prerelease":false,"html_url":"$REPO_URL/releases/tag/v1.3.0","assets":[{"name":"melodious-1.3.0.apk","browser_download_url":"$REPO_URL/releases/download/v1.3.0/melodious-1.3.0.apk"}]}]"""
        val server = CannedServer(listOf(200 to body, 304 to ""), mapOf("ETag" to "W/\"abc\""))
        val client = GitHubReleaseClient(releasesUrl = "http://127.0.0.1:${server.port}/releases")
        val fresh = client.fetch(null, "Melodious/1.2.0 (Android)") as ReleaseFetch.Fresh
        assertEquals("W/\"abc\"", fresh.etag)
        assertEquals("1.3.0", GitHubReleases.latestAndroid(fresh.releases)?.version)
        assertEquals(ReleaseFetch.NotModified, client.fetch(fresh.etag, "Melodious/1.2.0 (Android)"))
        assertEquals("Melodious/1.2.0 (Android)", server.requests[0]["user-agent"])
        assertEquals("W/\"abc\"", server.requests[1]["if-none-match"])
    }

    @Test
    fun fetchReportsRateLimitAndOffline() = runBlocking {
        val server = CannedServer(listOf(403 to "{}"), mapOf("x-ratelimit-reset" to "1900000000"))
        val limited = GitHubReleaseClient(releasesUrl = "http://127.0.0.1:${server.port}/r").fetch(null, "t")
        assertEquals(ReleaseFetch.RateLimited(1_900_000_000_000), limited)
        val dead = ServerSocket(0).use { it.localPort }
        val offline = GitHubReleaseClient(releasesUrl = "http://127.0.0.1:$dead/r").fetch(null, "t")
        assertEquals(ReleaseFetch.Failed("Couldn't reach GitHub."), offline)
    }

    @Test
    fun hubSoftwareFromApiVersion() = runBlocking {
        val server = CannedServer(listOf(200 to """{"ok":true,"version":"1.3.0"}""", 404 to """{"ok":false}"""))
        val endpoint = HubEndpoint(name = "Hub", host = "127.0.0.1", webUiPort = server.port)
        val rest = CodexHubRestClient()
        assertEquals(HubSoftware.Known("1.3.0"), rest.getHubSoftware(endpoint))
        assertEquals(HubSoftware.Legacy, rest.getHubSoftware(endpoint))
    }
}
