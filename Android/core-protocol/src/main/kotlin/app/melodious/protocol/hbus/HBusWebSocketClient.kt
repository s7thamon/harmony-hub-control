package app.melodious.protocol.hbus

import app.melodious.protocol.model.HubEndpoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.atomic.AtomicInteger

/**
 * Direct LAN WebSocket client to the hub's stock HBus engine (`<hub-ip>:8088`).
 *
 * Why this exists alongside `:8080` (`codex_webui`):
 * 1. **True Press-and-Hold**: Volume and D-pad keys can stream `press` -> `hold` (every 200ms) -> `release`
 *    frames over a single persistent socket without fork overhead.
 * 2. **Instant State Push**: When a household member presses an activity button on the physical universal remote
 *    handset, the hub pushes `connect.stateDigest?notify` immediately.
 */
class HBusWebSocketClient(
    private val scope: CoroutineScope,
    // Pings let a silently rebooted hub surface as a failure instead of a socket that looks open forever.
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(30, java.util.concurrent.TimeUnit.SECONDS)
        .build(),
) {
    sealed interface ConnectionState {
        data object Disconnected : ConnectionState
        data class Connecting(val endpoint: HubEndpoint) : ConnectionState
        data class Connected(val endpoint: HubEndpoint) : ConnectionState
        data class Error(val message: String) : ConnectionState
    }

    data class StateDigestEvent(
        val activityId: String,
        val activityStatus: Int,
        val stateVersion: Int?,
        val sleepTimer: SleepTimerState? = null,
    )

    private val requestIdSeq = AtomicInteger(100)
    private var webSocket: WebSocket? = null
    private var activeHoldJob: Job? = null
    private var hubId: String = "0"

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _stateEvents = MutableSharedFlow<StateDigestEvent>(extraBufferCapacity = 16)
    val stateEvents: SharedFlow<StateDigestEvent> = _stateEvents.asSharedFlow()

    /**
     * The stock HBus socket only accepts connections that name the hub's `activeRemoteId`.
     * The hub answers `setup.account?getProvisionInfo` over plain HTTP on the same port.
     */
    suspend fun fetchHubId(endpoint: HubEndpoint): String? = withContext(Dispatchers.IO) {
        runCatching {
            val body = """{"id":1,"cmd":"setup.account?getProvisionInfo","params":{}}"""
                .toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("http://${endpoint.host}:${endpoint.hbusPort}/")
                .header("Origin", "http://sl.dhg.myharmony.com")
                .post(body)
                .build()
            httpClient.newCall(request).execute().use { response ->
                val root = Json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
                (root["data"] as? JsonObject)?.get("activeRemoteId")?.jsonPrimitive?.content
                    ?.takeIf { it.isNotBlank() && it != "null" }
            }
        }.getOrNull()
    }

    fun connect(endpoint: HubEndpoint) {
        disconnect()
        hubId = endpoint.hubId.ifBlank { "0" }
        if (endpoint.isSimulated) {
            // The Node UI simulator only serves HTTP on :8787; HBus WS is only on real/QEMU hubs (:8088)
            _connectionState.value = ConnectionState.Disconnected
            return
        }
        _connectionState.value = ConnectionState.Connecting(endpoint)
        val request = Request.Builder()
            .url(endpoint.hbusWsUrl)
            .header("Origin", "http://sl.dhg.myharmony.com")
            .build()

        // Callbacks from a socket we already replaced must not overwrite the current state.
        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (webSocket !== this@HBusWebSocketClient.webSocket) return
                _connectionState.value = ConnectionState.Connected(endpoint)
                requestStateDigest()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (webSocket !== this@HBusWebSocketClient.webSocket) return
                handleIncomingFrame(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (webSocket !== this@HBusWebSocketClient.webSocket) return
                stopButtonHold()
                _connectionState.value = ConnectionState.Error(t.message ?: "HBus WebSocket failure")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (webSocket !== this@HBusWebSocketClient.webSocket) return
                _connectionState.value = ConnectionState.Error("Hub closed the connection ($code)")
            }
        })
    }

    fun disconnect() {
        stopButtonHold()
        webSocket?.close(1000, "Client closing")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
    }

    fun requestStateDigest(): Boolean = sendHBusCommand(
        cmd = "connect.statedigest?get",
        params = JsonObject(mapOf("format" to JsonPrimitive("json"))),
    )

    /**
     * Begins a continuous button press-and-hold session over HBus (`control.button?press` + `hold`),
     * automatically sending `release` when `stopButtonHold()` is called on finger up.
     */
    fun startButtonHold(deviceId: String, commandName: String) {
        stopButtonHold()
        val actionJson = """{"command":"$commandName","type":"IRCommand","deviceId":"$deviceId"}"""
        sendButtonFrame(actionJson, status = "press")

        activeHoldJob = scope.launch {
            while (isActive) {
                delay(200)
                sendButtonFrame(actionJson, status = "hold")
            }
        }
    }

    fun stopButtonHold(deviceId: String? = null, commandName: String? = null) {
        activeHoldJob?.cancel()
        activeHoldJob = null
        if (deviceId != null && commandName != null) {
            val actionJson = """{"command":"$commandName","type":"IRCommand","deviceId":"$deviceId"}"""
            sendButtonFrame(actionJson, status = "release")
        }
    }

    private fun sendButtonFrame(actionJson: String, status: String): Boolean {
        val params = JsonObject(
            mapOf(
                "action" to JsonPrimitive(actionJson),
                "status" to JsonPrimitive(status),
                "timestamp" to JsonPrimitive(System.currentTimeMillis().toString()),
            )
        )
        return sendHBusCommand("vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction", params)
    }

    private val pendingReplies = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.CompletableDeferred<JsonObject>>()

    /**
     * Sends an engine command and waits for its reply frame (matched by id). Returns null when the
     * socket is down or the hub doesn't answer in time.
     */
    suspend fun request(cmd: String, params: JsonObject = JsonObject(emptyMap()), timeoutMs: Long = 8_000): JsonObject? {
        val id = requestIdSeq.incrementAndGet().toString()
        val reply = kotlinx.coroutines.CompletableDeferred<JsonObject>()
        pendingReplies[id] = reply
        return try {
            if (!sendHBusCommand(cmd, params, id)) null
            else kotlinx.coroutines.withTimeoutOrNull(timeoutMs) { reply.await() }
        } finally {
            pendingReplies.remove(id)
        }
    }

    private fun sendHBusCommand(cmd: String, params: JsonObject, requestId: String? = null): Boolean {
        val ws = webSocket ?: return false
        val id = requestId ?: requestIdSeq.incrementAndGet().toString()
        val envelope = JsonObject(
            mapOf(
                "hubId" to JsonPrimitive(hubId),
                "timeout" to JsonPrimitive(30),
                "hbus" to JsonObject(
                    mapOf(
                        "cmd" to JsonPrimitive(cmd),
                        "id" to JsonPrimitive(id),
                        "params" to params,
                    )
                )
            )
        )
        return ws.send(envelope.toString())
    }

    private fun handleIncomingFrame(rawText: String) {
        try {
            val root = Json.parseToJsonElement(rawText).jsonObject
            root["id"]?.jsonPrimitive?.content?.let { pendingReplies[it]?.complete(root) }
            val dataObj = root["data"] as? JsonObject ?: return
            val activityId = dataObj["activityId"]?.jsonPrimitive?.content ?: return
            val activityStatus = dataObj["activityStatus"]?.jsonPrimitive?.intOrNull ?: 0
            val stateVersion = dataObj["stateVersion"]?.jsonPrimitive?.intOrNull
            _stateEvents.tryEmit(
                StateDigestEvent(
                    activityId = activityId,
                    activityStatus = activityStatus,
                    stateVersion = stateVersion,
                    sleepTimer = SleepTimerState.fromDigest(
                        timerId = dataObj["sleepTimerId"]?.jsonPrimitive?.intOrNull,
                        endEpochSeconds = dataObj["sleepTimerValue"]?.jsonPrimitive?.content?.toDoubleOrNull()?.toLong(),
                        hubEpochSeconds = dataObj["time"]?.jsonPrimitive?.content?.toLongOrNull(),
                    ),
                )
            )
        } catch (_: Exception) {
            // Non-digest HBus reply frame
        }
    }
}

/**
 * The hub's sleep timer, from the state digest. The end time is on the hub's clock, so it is
 * stored as seconds remaining at the moment the digest was produced.
 */
data class SleepTimerState(val timerId: Int, val secondsRemaining: Long) {
    companion object {
        fun fromDigest(timerId: Int?, endEpochSeconds: Long?, hubEpochSeconds: Long?): SleepTimerState? {
            if (timerId == null) return null
            if (timerId == -1 || endEpochSeconds == null || hubEpochSeconds == null) return SleepTimerState(-1, 0)
            return SleepTimerState(timerId, (endEpochSeconds - hubEpochSeconds).coerceAtLeast(0))
        }
    }

    val isRunning: Boolean get() = timerId != -1 && secondsRemaining > 0
}
