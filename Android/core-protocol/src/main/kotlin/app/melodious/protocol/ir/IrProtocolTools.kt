package app.melodious.protocol.ir

import app.melodious.protocol.model.IrCaptureAnalysis
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Pure Kotlin port of `tools/webui-sim/public/js/views/ir-model.js` and
 * `bluetooth-model.js` validators, mirroring `codex_webui.c` limits and parsers.
 */
object IrProtocolTools {
    const val LIMIT_DEVICE_ID = 63
    const val LIMIT_COMMAND = 127
    const val LIMIT_NAME = 127
    const val LIMIT_KEYCODE = 511
    const val LIMIT_RAW = 2047
    const val LIMIT_RUN_ID = 96
    const val LIMIT_RAW_IMPORT = 4096
    const val LIMIT_BATCH_COMMANDS = 1024
    const val LIMIT_STORED_COMMANDS = 2048
    const val LIMIT_DEVICES = 32
    const val DELAY_MIN_MS = 40
    const val DELAY_MAX_MS = 10000

    val DEVICE_TYPES = listOf(
        "Television",
        "Amplifier",
        "Media Player",
        "Game Console",
        "Home Appliance",
    )

    private val SAFE_RUN_ID_REGEX = Regex("^[A-Za-z0-9_.-]+$")
    private val NEC_HEX_REGEX = Regex("^(0x)?[0-9a-fA-F]{1,8}$")

    fun isSafeLabel(value: String?, maxLen: Int = LIMIT_NAME): Boolean {
        val s = value ?: return false
        if (s.isEmpty() || s.length > maxLen) return false
        for (ch in s) {
            val code = ch.code
            if (code < 32 || code == 127 || ch == '"' || ch == '\\') return false
        }
        return true
    }

    fun isSafeRunId(value: String?): Boolean {
        val s = value ?: return false
        return s.isNotEmpty() && s.length <= LIMIT_RUN_ID && SAFE_RUN_ID_REGEX.matches(s)
    }

    fun clampDelay(ms: Int): Int = ms.coerceIn(DELAY_MIN_MS, DELAY_MAX_MS)

    fun makeRunId(prefix: String = "android"): String {
        val rand = (Math.random() * 1e9).toLong().toString(36)
        val ts = System.currentTimeMillis().toString(36)
        return "${prefix}_${ts}_${rand}"
    }

    fun isValidBtAddr(value: String?): Boolean {
        val s = value ?: return false
        if (s.length != 17) return false
        for (i in 0 until 17) {
            val ch = s[i]
            if (i in setOf(2, 5, 8, 11, 14)) {
                if (ch != ':') return false
            } else if (!ch.isDigit() && ch.lowercaseChar() !in 'a'..'f') {
                return false
            }
        }
        return true
    }

    /**
     * Mirror of `rawFromTimings()`: `F<freqHex>` then `P`/`S<pulseHex>` pairs.
     */
    fun rawFromTimings(freqHz: Int, pulseValues: List<Int>): String {
        val f = freqHz.coerceIn(10_000, 60_000)
        val timed = pulseValues
            .map { abs(it).coerceIn(1, 0xFFFFF) }
            .filter { it > 0 }
            .toMutableList()
        if (timed.size == 3) timed.add(100_000)
        if (timed.size < 4) return ""

        val sb = StringBuilder("F").append(f.toString(16).uppercase())
        timed.forEachIndexed { index, v ->
            sb.append(if (index % 2 == 1) 'S' else 'P')
            sb.append(v.toString(16).uppercase())
        }
        val raw = sb.toString()
        return if (raw.length <= LIMIT_RAW_IMPORT) raw else ""
    }

    /**
     * Mirror of `prontoToHubRaw()`: converts learned (`0000`) Pronto hex strings into
     * Hub `F...P...S...` raw timing replay strings.
     */
    fun prontoToHubRaw(hex: String): String {
        val words = hex.trim()
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
            .map { it.toIntOrNull(16) ?: return "" }
        if (words.size < 8 || words[0] != 0) return ""
        val unit = (if (words[1] == 0) 1 else words[1]) * 0.241246
        val frequency = (1_000_000.0 / unit).roundToInt()
        val pairs = words[2] + words[3]
        val endIdx = min(words.size, 4 + pairs * 2)
        val vals = words.subList(4, endIdx).map { (it * unit).roundToInt() }
        return rawFromTimings(frequency, vals)
    }

    data class StagedIrdbRow(val name: String, val mode: String, val code: String)
    data class ParsedIrdbBatch(val rows: List<StagedIrdbRow>, val skipped: Int)

    /**
     * Client preview of `bulk_import_irdb_commands()`: parses pipe (`name|keycode`, `name|raw|F...`)
     * or IRDB CSV (`functionname,protocol,device,subdevice,function`) lines.
     */
    fun parseIrdbLines(text: String): ParsedIrdbBatch {
        val rows = mutableListOf<StagedIrdbRow>()
        var skipped = 0
        for (rawLine in text.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty()) continue
            if (line.contains("|")) {
                val parts = line.split("|").map { it.trim() }
                val name = parts.getOrNull(0).orEmpty()
                var mode = "keycode"
                var code = ""
                if (parts.size >= 3) {
                    val m = parts[1].lowercase()
                    when (m) {
                        "raw" -> {
                            mode = "raw"
                            code = parts[2]
                        }
                        "keycode" -> {
                            mode = "keycode"
                            code = parts[2]
                        }
                        else -> {
                            mode = "keycode"
                            code = parts[1]
                        }
                    }
                } else if (parts.size >= 2) {
                    code = parts[1]
                }
                if (name.isNotEmpty() && code.isNotEmpty() && isSafeLabel(name, LIMIT_NAME)) {
                    rows.add(StagedIrdbRow(name, mode, code))
                } else {
                    skipped += 1
                }
            } else {
                val parts = line.split(",").map { it.trim() }
                if (parts.size >= 5 && parts[0].lowercase() != "functionname" && isSafeLabel(parts[0], LIMIT_NAME)) {
                    rows.add(StagedIrdbRow(parts[0], "irdb", parts.subList(1, 5).joinToString(",")))
                } else {
                    skipped += 1
                }
            }
        }
        return ParsedIrdbBatch(rows, skipped)
    }

    fun analyzeCaptureJson(jsonObj: JsonObject): IrCaptureAnalysis {
        val raw = jsonObj["raw"]?.jsonPrimitive?.content?.trim().orEmpty()
        val keycode = jsonObj["keycode"]?.jsonPrimitive?.content?.trim().orEmpty()
        val nec = jsonObj["nec"]?.jsonPrimitive?.content?.trim().orEmpty()
        val looksEmpty = raw.isEmpty() ||
            Regex("no payload|returned no|timeout", RegexOption.IGNORE_CASE).containsMatchIn(raw) ||
            hbusDataIsEmpty(raw)
        val mode = when {
            keycode.isNotEmpty() -> "keycode"
            nec.isNotEmpty() -> "nec"
            !looksEmpty && raw.isNotEmpty() -> "raw"
            else -> ""
        }
        val protocolId = jsonObj["protocolId"]?.jsonPrimitive?.intOrNull?.takeIf { it > 0 } ?: 2
        return IrCaptureAnalysis(
            empty = mode.isEmpty(),
            mode = mode,
            keycode = keycode,
            nec = nec,
            raw = raw,
            protocolId = protocolId,
            analysis = jsonObj["analysis"]?.jsonPrimitive?.content?.trim().orEmpty(),
        )
    }

    private fun hbusDataIsEmpty(text: String): Boolean = try {
        val obj = Json.parseToJsonElement(text.trim()).jsonObject
        val data = obj["data"]
        data == null || (data is JsonObject && data.isEmpty())
    } catch (_: Exception) {
        false
    }
}
