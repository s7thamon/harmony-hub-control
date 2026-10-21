package app.melodious.protocol.discovery

import app.melodious.protocol.model.HubEndpoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/**
 * Discovers compatible hubs on the local network using:
 * 1. SSDP Multicast (`239.255.255.250:1900`) — stock UPnP discovery responder on `:8088`.
 * 2. Simulator / Emulator & Local HTTP probes (`10.0.2.2:8787`, `10.0.2.2:8080`, `127.0.0.1:8787`)
 *    so the Android Emulator connects to `tools/webui-sim` and `tools/hub-emu` out-of-the-box.
 */
class HubDiscovery(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(1500, TimeUnit.MILLISECONDS)
        .readTimeout(1500, TimeUnit.MILLISECONDS)
        .build()
) {
    companion object {
        private const val SSDP_ADDRESS = "239.255.255.250"
        private const val SSDP_PORT = 1900

        private val SSDP_MSEARCH_PAYLOAD = buildString {
            append("M-SEARCH * HTTP/1.1\r\n")
            append("HOST: $SSDP_ADDRESS:$SSDP_PORT\r\n")
            append("MAN: \"ssdp:discover\"\r\n")
            append("MX: 2\r\n")
            append("ST: urn:myharmony-com:device:harmony:1\r\n\r\n")
        }

        val DEFAULT_DEV_CANDIDATES = listOf(
            HubEndpoint(
                name = "Hub simulator (Android emulator)",
                host = "10.0.2.2",
                webUiPort = 8787,
                hbusPort = 8088,
                isSimulated = true,
            ),
            HubEndpoint(
                name = "QEMU Hub Emulator (Android Emulator)",
                host = "10.0.2.2",
                webUiPort = 8080,
                hbusPort = 8088,
                isSimulated = false,
            ),
            HubEndpoint(
                name = "Local Loopback Simulator",
                host = "127.0.0.1",
                webUiPort = 8787,
                hbusPort = 8088,
                isSimulated = true,
            ),
        )
    }

    /**
     * Scans the LAN via SSDP multicast + probes known dev/custom endpoints concurrently.
     */
    suspend fun discoverHubs(
        extraHosts: List<String> = emptyList(),
        ssdpTimeoutMs: Int = 1800,
    ): List<HubEndpoint> = withContext(Dispatchers.IO) {
        coroutineScope {
            val ssdpDeferred = async { scanSsdp(ssdpTimeoutMs) }
            val devProbes = DEFAULT_DEV_CANDIDATES.map { candidate ->
                async { probeCodexWebUi(candidate) }
            }
            val customProbes = extraHosts.map { host ->
                async {
                    probeCodexWebUi(HubEndpoint(name = "Hub ($host)", host = host))
                }
            }

            val ssdpHosts = ssdpDeferred.await()
            val ssdpVerified = ssdpHosts.map { endpoint ->
                async { probeCodexWebUi(endpoint) ?: endpoint }
            }.awaitAll()

            val results = LinkedHashMap<String, HubEndpoint>()
            for (ep in devProbes.awaitAll().filterNotNull() + customProbes.awaitAll().filterNotNull() + ssdpVerified) {
                results["${ep.host}:${ep.webUiPort}"] = ep
            }

            // If SSDP multicast is blocked by the router or AP isolation, perform a fast /24 TCP sweep on :8080
            if (results.values.none { !it.isSimulated }) {
                for (ep in sweepLocalSubnetForCodexWebUi()) {
                    results["${ep.host}:${ep.webUiPort}"] = ep
                }
            }
            results.values.toList()
        }
    }

    /**
     * Detects the phone's active IPv4 LAN prefix (e.g., `192.168.0`) and sweeps `.1`..`.254` on port 8080
     * with a 180ms TCP connect timeout and 32-way concurrency (~1.2s total) to locate `codex_webui`.
     */
    private suspend fun sweepLocalSubnetForCodexWebUi(): List<HubEndpoint> = coroutineScope {
        val prefix = detectLocalIpv4Prefix() ?: return@coroutineScope emptyList()
        val semaphore = Semaphore(32)
        (1..254).map { hostOctet ->
            val ip = "$prefix.$hostOctet"
            async {
                semaphore.withPermit {
                    if (isTcpPortOpen(ip, 8080, timeoutMs = 180)) {
                        probeCodexWebUi(HubEndpoint(name = "Hub ($ip)", host = ip, webUiPort = 8080))
                    } else {
                        null
                    }
                }
            }
        }.awaitAll().filterNotNull()
    }

    private fun isTcpPortOpen(host: String, port: Int, timeoutMs: Int): Boolean = try {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, port), timeoutMs)
            true
        }
    } catch (_: Exception) {
        false
    }

    private fun detectLocalIpv4Prefix(): String? = try {
        NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress.orEmpty() }
            .firstOrNull { ip ->
                ip.startsWith("192.168.") || ip.startsWith("10.") || ip.matches(Regex("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*"))
            }
            ?.substringBeforeLast('.')
    } catch (_: Exception) {
        null
    }

    /**
     * Verify whether `codex_webui` (or `webui-sim`) is answering at `http://<host>:<port>/api/system-status`.
     */
    fun probeCodexWebUi(candidate: HubEndpoint): HubEndpoint? {
        val req = Request.Builder()
            .url("${candidate.baseUrl}/api/system-status")
            .apply {
                candidate.basicAuthHeader?.let { header("Authorization", it) }
            }
            .get()
            .build()

        return try {
            httpClient.newCall(req).execute().use { response ->
                if (!response.isSuccessful && response.code != 401) return null
                val body = response.body?.string().orEmpty()
                val json = runCatching { Json.parseToJsonElement(body).jsonObject }.getOrNull()
                val fw = json?.get("firmware")?.jsonPrimitive?.content.orEmpty()
                val uname = json?.get("uname")?.jsonPrimitive?.content.orEmpty()
                val isSim = candidate.isSimulated || uname.contains("sim", ignoreCase = true) || candidate.webUiPort == 8787
                candidate.copy(
                    firmware = fw.ifBlank { candidate.firmware },
                    isSimulated = isSim,
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun scanSsdp(timeoutMs: Int): List<HubEndpoint> {
        val discovered = LinkedHashMap<String, HubEndpoint>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 450
                val payloadBytes = SSDP_MSEARCH_PAYLOAD.toByteArray(Charsets.UTF_8)
                val group = InetAddress.getByName(SSDP_ADDRESS)
                val packet = DatagramPacket(payloadBytes, payloadBytes.size, group, SSDP_PORT)
                socket.send(packet)

                val deadline = System.currentTimeMillis() + timeoutMs
                val buf = ByteArray(2048)
                while (System.currentTimeMillis() < deadline) {
                    try {
                        val recv = DatagramPacket(buf, buf.size)
                        socket.receive(recv)
                        val text = String(recv.data, 0, recv.length, Charsets.UTF_8)
                        val host = recv.address.hostAddress ?: continue
                        if (text.contains("myharmony", ignoreCase = true) ||
                            text.contains("harmony", ignoreCase = true) ||
                            text.contains(":8088")
                        ) {
                            discovered[host] = HubEndpoint(
                                name = "Hub ($host)",
                                host = host,
                                webUiPort = 8080,
                                hbusPort = 8088,
                            )
                        }
                    } catch (_: SocketTimeoutException) {
                        // Continue until deadline
                    }
                }
            }
        } catch (_: Exception) {
            // Multicast unavailable on this interface
        }
        return discovered.values.toList()
    }
}
